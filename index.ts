import { createBuffer } from '@posthog/plugin-contrib'
import { S3 } from 'aws-sdk'
import { randomBytes } from 'crypto'
import { brotliCompressSync, gzipSync } from 'zlib'
import { Plugin, PluginMeta, PluginEvent, PluginJobs } from '@posthog/plugin-scaffold'
import { ManagedUpload } from 'aws-sdk/clients/s3'

type S3Meta = PluginMeta<{
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
        prefix: string
        uploadMinutes: string
        uploadMegabytes: string
        eventsToIgnore: string
        uploadFormat: 'jsonl'
        compression: 'gzip' | 'brotli' | 'no compression'
    }
}>
type S3Plugin = Plugin<S3Meta>

interface UploadJobPayload {
    batch: PluginEvent[]
    batchId: number
    retriesPerformedSoFar: number
}

class UploadError extends Error {}

export const jobs: PluginJobs<S3Meta> = {
    uploadBatchToS3: async (payload: UploadJobPayload, meta: S3Meta) => {
        const { jobs } = meta
        try {
            sendBatchToS3(payload.batch, meta)
        } catch (err) {
            if (err.constructor === UploadError && payload.retriesPerformedSoFar < 15) {
                const nextRetryMs = 2 ** payload.retriesPerformedSoFar * 3000 // here
                console.log(`Enqueued batch ${payload.batchId} for retry in ${nextRetryMs}ms`)
                await jobs
                    .uploadBatchToS3({
                        batch: payload.batch,
                        batchId: payload.batchId,
                        retriesPerformedSoFar: payload.retriesPerformedSoFar + 1,
                    })
                    .runIn(nextRetryMs, 'milliseconds')
                return
            }
            throw err
        }
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

    const uploadMegabytes = Math.max(1, Math.min(parseInt(config.uploadMegabytes) || 1, 100))
    const uploadMinutes = Math.max(1, Math.min(parseInt(config.uploadMinutes) || 1, 60))

    global.s3 = new S3({
        accessKeyId: config.awsAccessKey,
        secretAccessKey: config.awsSecretAccessKey,
        region: config.awsRegion,
    })

    global.buffer = createBuffer({
        limit: uploadMegabytes * 1024 * 1024,
        timeoutSeconds: uploadMinutes * 60, // here
        onFlush: async (batch) => {
            await jobs.uploadBatchToS3({ batch, batchId: Math.floor(Math.random() * 1000000), retriesPerformedSoFar: 0 }).runNow()
        },
    })

    global.eventsToIgnore = new Set(
        config.eventsToIgnore ? config.eventsToIgnore.split(',').map((event) => event.trim()) : null
    )
}

export const onEvent = (event: PluginEvent, { global }: S3Meta) => {
    if (!global.eventsToIgnore.has(event.event)) {
        global.buffer.add(event)
    }
}

export const sendBatchToS3 = (batch: PluginEvent[], { global, config }: S3Meta) => {
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

    console.log(`Flushing ${batch.length} events!`)
    global.s3.upload(params, (err: Error, data: ManagedUpload.SendData) => {
        if (err) {
            console.error(`Error uploading to S3: ${err.message}`)
            throw new UploadError()
        }
        console.log(`Uploaded ${batch.length} event${batch.length === 1 ? '' : 's'} to ${data.Location}`)
    })
}
