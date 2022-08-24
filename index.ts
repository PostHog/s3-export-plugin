import { S3 } from 'aws-sdk'
import { randomBytes } from 'crypto'
import { brotliCompressSync, gzipSync } from 'zlib'
import { Plugin, PluginMeta, ProcessedPluginEvent, RetryError } from '@posthog/plugin-scaffold'
import { ManagedUpload } from 'aws-sdk/clients/s3'

export type PluginConfig = {
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
    signatureVersion: '' | 'v4'
    sse: 'disabled' | 'AES256' | 'aws:kms'
    sseKmsKeyId: string
    s3ForcePathStyle: 'true' | 'false'
}

type S3Plugin = Plugin<{
    global: {
        s3: S3
        eventsToIgnore: Set<string>
    }
    config: PluginConfig
}>

export function convertEventBatchToBuffer(events: ProcessedPluginEvent[]): Buffer {
    return Buffer.from(events.map((event) => JSON.stringify(event)).join('\n'), 'utf8')
}

export const setupPlugin: S3Plugin['setupPlugin'] = (meta) => {
    const { global, config } = meta
    if (!config.awsAccessKey) {
        throw new Error('AWS access key missing!')
    }
    if (!config.awsSecretAccessKey) {
        throw new Error('AWS secret access key missing!')
    }
    if (!config.awsRegion && !config.s3BucketEndpoint) {
        throw new Error('AWS region must be set if config.s3BucketEndpoint is unset!')
    }
    if (!config.s3BucketName) {
        throw new Error('S3 bucket name missing!')
    }
    if (config.sse === 'aws:kms' && !config.sseKmsKeyId) {
        throw new Error('AWS KMS encryption requested but no KMS key ID provided!')
    }

    const s3Config: S3.ClientConfiguration = {
        accessKeyId: config.awsAccessKey,
        secretAccessKey: config.awsSecretAccessKey,
    }

    if (config.awsRegion) {
        s3Config.region = config.awsRegion
    }

    if (config.signatureVersion) {
        s3Config.signatureVersion = config.signatureVersion
    }

    if (config.s3ForcePathStyle === 'true') {
        s3Config.s3ForcePathStyle = true
    }

    if (config.s3BucketEndpoint) {
        s3Config.endpoint = config.s3BucketEndpoint
    }

    global.s3 = new S3(s3Config)

    global.eventsToIgnore = new Set(
        config.eventsToIgnore ? config.eventsToIgnore.split(',').map((event) => event.trim()) : null
    )
}

export const exportEvents: S3Plugin['exportEvents'] = async (events, meta) => {
    const eventsToExport = events.filter(event => !meta.global.eventsToIgnore.has(event.event))
    if (eventsToExport.length > 0) {
        await sendBatchToS3(events, meta)
    }
}

export const sendBatchToS3 = async (events: ProcessedPluginEvent[], meta: PluginMeta<S3Plugin>) => {
    const { global, config } = meta

    console.log(`Trying to send batch to S3...`)

    const date = new Date().toISOString()
    const [day, time] = date.split('T')
    const dayTime = `${day.split('-').join('')}-${time.split(':').join('')}`
    const suffix = randomBytes(8).toString('hex')

    const params: S3.PutObjectRequest = {
        Bucket: config.s3BucketName,
        Key: `${config.prefix || ''}${day}/${dayTime}-${suffix}.jsonl`,
        Body: convertEventBatchToBuffer(events),
    }

    if (config.compression === 'gzip') {
        params.Key = `${params.Key}.gz`
        params.Body = gzipSync(params.Body as Buffer)
    }

    if (config.compression === 'brotli') {
        params.Key = `${params.Key}.br`
        params.Body = brotliCompressSync(params.Body as Buffer)
    }

    if (config.sse !== 'disabled') {
        params.ServerSideEncryption = config.sse
    }

    if (config.sse === 'aws:kms') {
        params.SSEKMSKeyId = config.sseKmsKeyId
    }

    return new Promise<void>((resolve, reject) => {
        global.s3.upload(params, (err: Error, _: ManagedUpload.SendData) => {
            if (err) {
                console.error(`Error uploading to S3: ${err.message}`)
                return reject(new RetryError())
            }
            console.log(`Uploaded ${events.length} event${events.length === 1 ? '' : 's'} to bucket ${config.s3BucketName}`)
            resolve()
        })
    })
}
