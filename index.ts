import { S3 } from 'aws-sdk'
import { randomBytes } from 'crypto'
import { brotliCompressSync, gzipSync } from 'zlib'
import { Plugin, PluginMeta, PluginEvent, RetryError } from '@posthog/plugin-scaffold'

type S3Plugin = Plugin<{
    global: {
        s3: S3
    }
    config: {
        awsAccessKey: string
        awsSecretAccessKey: string
        awsRegion: string
        s3BucketName: string
        prefix: string
        uploadFormat: 'jsonl'
        compression: 'gzip' | 'brotli' | 'no compression'
    }
}>

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

    global.s3 = new S3({
        accessKeyId: config.awsAccessKey,
        secretAccessKey: config.awsSecretAccessKey,
        region: config.awsRegion,
    })
}

export const exportEvents = async (events: PluginEvent[], { global, config }: PluginMeta<S3Plugin>) => {
    const date = new Date().toISOString()
    const [day, time] = date.split('T')
    const dayTime = `${day.split('-').join('')}-${time.split(':').join('')}`
    const suffix = randomBytes(8).toString('hex')

    const params = {
        Bucket: config.s3BucketName,
        Key: `${config.prefix || ''}${day}/${dayTime}-${suffix}.jsonl`,
        Body: Buffer.from(events.map((event) => JSON.stringify(event)).join('\n'), 'utf8'),
    }

    if (config.compression === 'gzip') {
        params.Key = `${params.Key}.gz`
        params.Body = gzipSync(params.Body)
    }

    if (config.compression === 'brotli') {
        params.Key = `${params.Key}.br`
        params.Body = brotliCompressSync(params.Body)
    }

    console.log(`Flushing ${events.length} events!`)

    await new Promise(((resolve, reject) => {
        global.s3.upload(params, async (err: Error, data: S3.ManagedUpload.SendData) => {
            if (err) {
                reject(new RetryError(err.message))
            } else {
                console.log(`Uploaded ${events.length} event${events.length === 1 ? '' : 's'} to ${data.Location}`)
                resolve(data)
            }
        })
    }))
}
