import { createBuffer } from '@posthog/plugin-contrib'
import { S3 } from 'aws-sdk'
import { randomBytes } from 'crypto'
import { brotliCompressSync, gzipSync } from 'zlib'

export function setupPlugin({ global, config }) {
    if (!config.awsAccessKey) {
        throw new Error('AWS Access Key missing')
    }
    if (!config.awsSecretAccessKey) {
        throw new Error('AWS Secret Access Key missing')
    }
    if (!config.awsRegion) {
        throw new Error('AWS Region missing')
    }
    if (!config.s3BucketName) {
        throw new Error('S3 bucket name missing')
    }

    const uploadMegaBytes = Math.max(1, Math.min(parseInt(config.uploadMegaBytes) || 1, 100))
    const uploadMinutes = Math.max(1, Math.min(parseInt(config.uploadMinutes) || 1, 60))

    global.s3 = new S3({
        accessKeyId: config.awsAccessKey,
        secretAccessKey: config.awsSecretAccessKey,
        region: config.awsRegion,
    })

    global.buffer = createBuffer({
        limit: uploadMegaBytes * 1024 * 1024,
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
                Body: new Buffer(batch.map(JSON.stringify).join('\n'), 'utf8'),
            }

            if (config.compression === 'gzip') {
                params.Key = `${params.Key}.gz`
                params.Body = gzipSync(params.Body)
            }

            if (config.compression === 'brotli') {
                params.Key = `${params.Key}.br`
                params.Body = brotliCompressSync(params.Body)
            }

            global.s3.upload(params, (s3Err, data) => {
                if (s3Err) {
                    console.error(`Error uploading to S3: ${s3Err.message}`)
                    throw s3Err
                }
                console.log(`Uploaded ${batch.length} event${batch.length === 1 ? '' : 's'} to ${data.Location}`)
            })
        },
    })
    global.eventsToIgnore = Object.fromEntries(
        (config.eventsToIgnore || '').split(',').map((event) => [event.trim(), true])
    )
}

export function processEvent(event, { global }) {
    if (!global.eventsToIgnore[event.event]) {
        global.buffer.add(event)
    }
    return event
}
