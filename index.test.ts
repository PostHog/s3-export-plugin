import { convertEventBatchToBuffer, sendBatchToS3 } from './index'


const mockedS3 = {
    upload: jest.fn()
}

describe('S3 Plugin', () => {
    let mockedMeta: any

    beforeEach(() => {
        mockedMeta = {
            global: {
                s3: mockedS3,
                buffer: {
                    add: jest.fn()
                },
                eventsToIgnore: new Set(['ignore me'])
            },
            config: {
                awsAccessKey: 'KEY',
                awsSecretAccessKey: 'SECRET_KEY',
                awsRegion: 'us-east-1',
                s3BucketName: 'mybucket',
                s3BucketEndpoint: 'some.endpoint',
                prefix: 'custom_prefix_',
                uploadFormat: 'jsonl',
                compression: 'gzip',
                signatureVersion: '',
                sse: 'disabled',
            },
        }
    })

    describe('sendBatchToS3()', () => {
        test('uploads to S3', async () => {
            const payload = {
                batch: [
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
                ],
                batchId: 1234,
                retriesPerformedSoFar: 0
            }
            await sendBatchToS3(payload, mockedMeta as any)

            const uploadCall = mockedS3.upload.mock.calls[0]

            expect(uploadCall[0].Bucket).toEqual('mybucket')
            expect(uploadCall[0].Key).toContain('custom_prefix_')
            expect(uploadCall[0].Key).toContain('.jsonl')

            expect(Buffer.compare(uploadCall[0].Body,convertEventBatchToBuffer(payload.batch))).toBeTruthy()
        })
    }) 

})

