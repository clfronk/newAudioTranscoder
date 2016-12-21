"use strict";

var AWS = require("aws-sdk");

var S3 = new AWS.S3();
var elasticTranscoder = new AWS.ElasticTranscoder();

exports.handler = function(event, context, callback)
{
    var srcBucket = event.Records[0].s3.bucket.name;
    var srcKey = decodeURIComponent(event.Records[0].s3.object.key.replace(/\+/g, " "));
    
    outputKey = srcKey + ".mp3";
    
    var params = {
      PipelineId: process.env.PIPELINE_ID,
      Input: {
          Key: srcKey,
          Container: auto
      },
      Output: {
          Key: outputKey,
          PresetId: process.env.MP3_PRESET_ID
      }
    };
    
    elasticTranscoder.createJob( params, function(err, data) {
        if (err)
        {
            console.log(err);
        }
    } );
    
}