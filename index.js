import { createBuffer } from '@posthog/plugin-contrib'
import { S3 } from 'aws-sdk'
import { randomBytes } from 'crypto'

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

    global.s3 = new S3({
        accessKeyId: config.awsAccessKey,
        secretAccessKey: config.awsSecretAccessKey,
        region: config.awsRegion,
    })

    global.buffer = createBuffer({
        limit: (parseInt(config.uploadMegabytes) || 1) * 1024 * 1024,
        timeoutSeconds: (parseInt(config.uploadMinutes) || 1) * 60,
        onFlush: (batch) => {
            console.log(`Flushing ${batch.length} events!`)
            const date = new Date().toISOString()
            const [day, time] = date.split('T')
            const suffix = randomBytes(20).toString('hex')

            const params = {
                Bucket: config.s3BucketName,
                Key: `${config.prefix || ''}${day}/${time}-${suffix}.jsonl`,
                Body: batch.map(JSON.stringify).join("\n")
            }

            global.s3.upload(params, (s3Err, data) => {
                console.log('S3 upload callback', !!s3Err)
                if (s3Err) {
                    console.log(s3Err.message)
                    throw s3Err
                }
                console.log(`Uploaded successfully at ${data.Location}`)
            })
        }
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