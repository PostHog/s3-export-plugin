import { createBuffer } from '@posthog/plugin-contrib'
import { S3 } from 'aws-sdk'
import { randomBytes } from 'crypto'
import { brotliCompressSync, gzipSync } from 'zlib'
import { Plugin, PluginMeta, PluginEvent } from '@posthog/plugin-scaffold'
import { ManagedUpload } from 'aws-sdk/clients/s3'

type S3Plugin = Plugin<{
    global: {
        s3: S3
        buffer: ReturnType<typeof createBuffer>
        eventsToIgnore: Set<string>
    }
    config: {
        awsAccessKey: string
        awsSecretAccessKey: string
        awsRegion: string
        s3BucketName: string
        s3BucketEndpoint: string
        prefix: string
        uploadMinutes: string
        uploadMegabytes: string
        eventsToIgnore: string
        uploadFormat: 'jsonl'
        compression: 'gzip' | 'brotli' | 'no compression'
        signatureVersion: '' | 'v4',
        sse: 'disabled' | 'AES256' | 'aws:kms',
        sseKmsKeyId: string
    }
    jobs: {
        uploadBatchToS3: UploadJobPayload
    }
}>

interface UploadJobPayload {
    batch: PluginEvent[]
    batchId: number
    retriesPerformedSoFar: number
}

export const jobs: S3Plugin['jobs'] = {
    uploadBatchToS3: async (payload, meta) => {
        await sendBatchToS3(payload, meta)
    },
}

export const setupPlugin: S3Plugin['setupPlugin'] = (meta) => {
    const { global, config, jobs } = meta
    if (!config.awsAccessKey) {
        throw new Error('AWS access key missing!')
    }
    if (!config.awsSecretAccessKey) {
        throw new Error('AWS secret access key missing!')
    }
    if (!config.awsRegion) {
        throw new Error('AWS region missing!')
    }
    if (!config.s3BucketName) {
        throw new Error('S3 bucket name missing!')
    }
    if (config.sse === 'aws:kms' && !config.sseKmsKeyId) {
        throw new Error('AWS KMS encryption requested but no KMS key ID provided!')
    }

    const uploadMegabytes = Math.max(1, Math.min(parseInt(config.uploadMegabytes) || 1, 100))
    const uploadMinutes = Math.max(1, Math.min(parseInt(config.uploadMinutes) || 1, 60))

    const s3Config = {
        accessKeyId: config.awsAccessKey,
        secretAccessKey: config.awsSecretAccessKey,
        region: config.awsRegion,
        ...(config.signatureVersion ? { signatureVersion: config.signatureVersion } : {})
    }

    if (config.s3BucketEndpoint) {
	    s3Config.endpoint = config.s3BucketEndpoint
    }

    global.s3 = new S3(s3Config)

    global.buffer = createBuffer({
        limit: uploadMegabytes * 1024 * 1024,
        timeoutSeconds: uploadMinutes * 60,
        onFlush: async (batch) => {
            sendBatchToS3({ batch, batchId: Math.floor(Math.random() * 1000000), retriesPerformedSoFar: 0 }, meta)
        },
    })

    global.eventsToIgnore = new Set(
        config.eventsToIgnore ? config.eventsToIgnore.split(',').map((event) => event.trim()) : null
    )
}

export const onEvent: S3Plugin['onEvent'] = (event, { global }) => {
    if (!global.eventsToIgnore.has(event.event)) {
        global.buffer.add(event)
    }
}

export const sendBatchToS3 = async (payload: UploadJobPayload, meta: PluginMeta<S3Plugin>) => {
    const { global, config, jobs } = meta

    const { batch } = payload
    const date = new Date().toISOString()
    const [day, time] = date.split('T')
    const dayTime = `${day.split('-').join('')}-${time.split(':').join('')}`
    const suffix = randomBytes(8).toString('hex')

    const params = {
        Bucket: config.s3BucketName,
        Key: `${config.prefix || ''}${day}/${dayTime}-${suffix}.jsonl`,
        Body: Buffer.from(batch.map((event) => JSON.stringify(event)).join('\n'), 'utf8'),
    }

    if (config.compression === 'gzip') {
        params.Key = `${params.Key}.gz`
        params.Body = gzipSync(params.Body)
    }

    if (config.compression === 'brotli') {
        params.Key = `${params.Key}.br`
        params.Body = brotliCompressSync(params.Body)
    }

    if (config.sse !== 'disabled') {
        params.ServerSideEncryption = config.sse
    }

    if (config.sse === 'aws:kms') {
        params.SSEKMSKeyId = config.sseKmsKeyId
    }

    console.log(`Flushing ${batch.length} events!`)
    global.s3.upload(params, async (err: Error, _: ManagedUpload.SendData) => {
        if (err) {
            console.error(`Error uploading to S3: ${err.message}`)
            if (payload.retriesPerformedSoFar >= 15) {
                return
            }
            const nextRetryMs = 2 ** payload.retriesPerformedSoFar * 3000
            console.log(`Enqueued batch ${payload.batchId} for retry in ${nextRetryMs}ms`)
            await jobs
                .uploadBatchToS3({
                    ...payload,
                    retriesPerformedSoFar: payload.retriesPerformedSoFar + 1,
                })
                .runIn(nextRetryMs, 'milliseconds')
        }
        console.log(`Uploaded ${batch.length} event${batch.length === 1 ? '' : 's'} to bucket ${config.s3BucketName}`)
    })
}
