import { createBuffer } from '@posthog/plugin-contrib'
import { S3 } from 'aws-sdk'
import { randomBytes } from 'crypto'
import { brotliCompressSync, gzipSync } from 'zlib'
import { Plugin, PluginMeta } from '@posthog/plugin-scaffold'
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

export const setupPlugin: S3Plugin['setupPlugin'] = ({ global, config }) => {
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
        timeoutSeconds: uploadMinutes * 60,
        onFlush: (batch) => {
            console.log(`Flushing ${batch.length} events!`)
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
            global.s3.upload(params, (err: Error, data: ManagedUpload.SendData) => {
                if (err) {
                    console.error(`Error uploading to S3: ${err.message}`)
                    throw err
                }
                console.log(`Uploaded ${batch.length} event${batch.length === 1 ? '' : 's'} to ${data ? data.Location || '' : ''}`)
            })
        },
    })
    global.eventsToIgnore = new Set(
        config.eventsToIgnore ? config.eventsToIgnore.split(',').map((event) => event.trim()) : null
    )
}

export const processEvent: S3Plugin['processEvent'] = (event, { global }) => {
    if (!global.eventsToIgnore.has(event.event)) {
        global.buffer.add(event)
    }
    return event
}
