import { RetryError } from '@posthog/plugin-scaffold'
import { convertEventBatchToBuffer, exportEvents, PluginConfig, setupPlugin } from './index'


const mockedS3 = {
    upload: jest.fn().mockImplementation((_, callback) => setImmediate(callback))
}

const events = [
    {
        event: 'test',
        properties: {},
        distinct_id: 'did1',
        team_id: 1,
        uuid: '37114ebb-7b13-4301-b849-0d0bd4d5c7e5',
        ip: '127.0.0.1',
        timestamp: '2022-08-18T15:42:32.597Z',
    },
    {
        event: 'test2',
        properties: {},
        distinct_id: 'did1',
        team_id: 1,
        uuid: '37114ebb-7b13-4301-b859-0d0bd4d5c7e5',
        ip: '127.0.0.1',
        timestamp: '2022-08-18T15:42:32.597Z',
        elements: [{ attr_id: 'haha' }],
    },
]

const defaultConfig: PluginConfig = {
    awsAccessKey: 'KEY',
    awsSecretAccessKey: 'SECRET_KEY',
    awsRegion: 'us-east-1',
    s3BucketName: 'mybucket',
    s3BucketEndpoint: '',
    prefix: 'custom_prefix_',
    uploadFormat: 'jsonl',
    compression: 'gzip',
    signatureVersion: '',
    sse: 'disabled',
    uploadMinutes: '1',
    uploadMegabytes: '2',
    eventsToIgnore: '$feature_flag_called',
    sseKmsKeyId: '',
    s3ForcePathStyle: 'false',
}

describe('S3 Plugin', () => {
    let mockedMeta: any

    beforeEach(() => {
        jest.clearAllMocks()

        console.log = jest.fn()
        console.error = jest.fn()

        mockedMeta = {
            global: {
                s3: mockedS3,
                buffer: {
                    add: jest.fn()
                },
                eventsToIgnore: new Set(['ignore me'])
            },
            config: defaultConfig
        }
    })

    describe('setupPlugin()', () => {
        function callSetupPlugin(configOverrides: Partial<PluginConfig>): any {
            const meta = { global: {}, config: { ...defaultConfig, ...configOverrides } }
            setupPlugin!(meta as any)
            return meta.global
        }

        it('s3 config sets appropriate config for default config', () => {
            const global = callSetupPlugin(defaultConfig)
            expect(global.s3.config).toEqual(
                expect.objectContaining({
                    accessKeyId: defaultConfig.awsAccessKey,
                    secretAccessKey: defaultConfig.awsSecretAccessKey,
                    region: defaultConfig.awsRegion,
                    endpoint: 's3.amazonaws.com',
                    signatureVersion: 's3',
                    s3ForcePathStyle: false,
                })
            )
        })

        it('s3 config respects overrides', () => {
            const global = callSetupPlugin({
                ...defaultConfig,
                awsRegion: '',
                s3BucketEndpoint: 'some.endpoint',
                signatureVersion: 'v4',
                s3ForcePathStyle: 'true',
            })
            expect(global.s3.config).toEqual(
                expect.objectContaining({
                    accessKeyId: defaultConfig.awsAccessKey,
                    secretAccessKey: defaultConfig.awsSecretAccessKey,
                    endpoint: 'some.endpoint',
                    signatureVersion: 'v4',
                    s3ForcePathStyle: true,
                })
            )
        })

        it('raises errors for missing configs', () => {
            expect(() => callSetupPlugin({})).not.toThrow()
            expect(() => callSetupPlugin({ awsAccessKey: '' })).toThrow()
            expect(() => callSetupPlugin({ awsSecretAccessKey: '' })).toThrow()
            expect(() => callSetupPlugin({ awsRegion: '' })).toThrow()
            expect(() => callSetupPlugin({ awsRegion: '', s3BucketEndpoint: 'some.endpoint' })).not.toThrow()
            expect(() => callSetupPlugin({ s3BucketName: '' })).toThrow()
            expect(() => callSetupPlugin({ sse: 'aws:kms', sseKmsKeyId: '' })).toThrow()
            expect(() => callSetupPlugin({ sse: 'aws:kms', sseKmsKeyId: 'foo' })).not.toThrow()
        })
    })

    describe('exportEvents()', () => {
        it('uploads to S3', async () => {
            await exportEvents!(events, mockedMeta as any)

            const uploadCall = mockedS3.upload.mock.calls[0]

            expect(uploadCall[0].Bucket).toEqual('mybucket')
            expect(uploadCall[0].Key).toContain('custom_prefix_')
            expect(uploadCall[0].Key).toContain('.jsonl')

            expect(Buffer.compare(uploadCall[0].Body,convertEventBatchToBuffer(events))).toBeTruthy()
        })

        it('ignores events in eventsToIgnore', async () => {
            const events = [
                {
                    event: 'ignore me',
                    properties: {},
                    distinct_id: 'did1',
                    team_id: 1,
                    uuid: '37114ebb-7b13-4301-b849-0d0bd4d5c7e5',
                    ip: '127.0.0.1',
                    timestamp: '2022-08-18T15:42:32.597Z',
                },
            ]
            await exportEvents!(events, mockedMeta as any)

            expect(mockedS3.upload).not.toHaveBeenCalled()
        })

        it('raises a RetryError on upload failures', async () => {
            mockedS3.upload.mockImplementation((params, callback) => {
                setImmediate(() => {
                    callback(new Error("upload error"))
                })
            })

            await expect(exportEvents!(events, mockedMeta as any)).rejects.toEqual(new RetryError())
        })
    })

})

