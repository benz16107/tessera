import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sign } from '../src/s3.ts';

// AWS's published SigV4 example "GET Bucket Lifecycle" (S3 API reference, sig-v4-header-based-auth).
test('sign matches the AWS SigV4 known answer', () => {
  const h = sign({
    method: 'GET', host: 'examplebucket.s3.amazonaws.com', path: '/', query: 'lifecycle=',
    payloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', amzDate: '20130524T000000Z', region: 'us-east-1',
    accessKey: 'AKIAIOSFODNN7EXAMPLE', secretKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  });
  assert.equal(h.authorization, 'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, ' +
    'SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=fea454ca298b7da1c68078a5d1bdbfbbe0d65c699e0f91ac7a200a0136783543');
});
