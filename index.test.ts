import { createEvent, getMeta, resetMeta } from "@posthog/plugin-scaffold/test/utils";
import { setupPlugin, sendBatchToS3 } from "./index";
import { SinonStub, stub } from "sinon";
import { S3 } from "aws-sdk";

describe("without SSE", () => {
    let s3UploadStub: SinonStub;

    beforeAll(() => {
        resetMeta({
            config: {
                awsAccessKey: "DEADBEEF",
                awsSecretAccessKey: "bestkeptsecret",
                awsRegion: "there",
                s3BucketName: "the-bucket",
                sse: "disabled",
            },
        });

        setupPlugin!(getMeta());

      s3UploadStub = stub(S3.prototype, "upload");
    });

    it("uploads events to S3", async () => {
        const event = createEvent(
            { event: "something happened" }
        );

        await sendBatchToS3(
            {
                batch: [event],
                batchId: 0,
                retriesPerformedSoFar: 0
            },
            getMeta()
        );

        console.log(s3UploadStub.lastCall.args);
    });
});
