# S3 Export Plugin

Sends events to a S3 on ingestion. Requires PostHog 1.24+

## Installation

1. Visit 'Plugins' in PostHog.
1. Find this plugin from the repository or install `https://github.com/PostHog/s3-export-plugin`
1. Configure the plugin by entering your AWS credentials and S3 bucket details.
1. Watch events roll into S3.

## Getting access keys

1. Log in to [AWS](https://console.aws.amazon.com/).
1. Open [S3](https://s3.console.aws.amazon.com/) in the AWS console and create a new bucket in your chosen region.
1. Open [IAM](https://console.aws.amazon.com/iam/home) and create a new policy to allow access to this bucket.
    1. Open "Policies" and click "Create policy"
    1. On the "Visual Editor" tab, click "Choose a service" and select "S3"
    1. Under "Actions" select
        1. "Write" -> "PutObject"
        1. "Permission Management" -> "PutObjectAcl" 
    1. Under "Resources" select "Specific" and click "object" -> "Add ARN"
    1. Specify your bucket name and choose "any" for the object name, so the ARN looks something like this: `arn:aws:s3:::my-bucket-name/*`
    1. Click "Next" until you end up on the "Review Policy" page
    1. Give it a name
1. Open [IAM](https://console.aws.amazon.com/iam/home) and create a new user who uses this policy
    1. Click "Users" -> "Add User"
    1. Specify a name and choose "Programmatic access"
    1. Click "Next" 
    1. Select "Attach existing policies directly"
    1. Select the policy you had just created
    1. Click "Next" until you reach the "Create user" button. Click that as well.
    1. Make sure to copy your "Access key" and "Secret access key". The latter will not be shown again.
1. Install the plugin in PostHog and fill in the "Access key", "Secret access key", "Bucket region" and "Bucket name" fields. Adjust other parameters as needed.

## Note about memory usage

This plugin batches events in memory before uploading them to S3. The upload frequency (every minute) and maximum upload 
size (1 MB) can be configured after installing the plugin.

You should make sure to keep these numbers reasonable to avoid running out of memory on your server.

These values apply separately for each concurrent thread running in the plugin server. 

## Note about errors

If you incorrectly configured your bucket or access roles, you will not get an error message. This will change once
[this issue](https://github.com/PostHog/plugin-server/issues/72) is resolved. Thank you for your patience! 