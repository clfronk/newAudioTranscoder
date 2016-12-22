"use strict";

var AWS = require("aws-sdk");
var FS = require('fs');
var MM = require('musicmetadata');
var streamifier = require("streamifier");

var S3 = new AWS.S3();
var docClient = new AWS.DynamoDB.DocumentClient();
var elasticTranscoder = new AWS.ElasticTranscoder();

function preprocessName(origName)
{
    var processedName = "";
    origName = origName.toLowerCase();
    for ( var i = 0; i < origName.length; i++ )
    {
        var charStr = origName.charAt(i);
        var pattern = /[a-z0-9]/;
        if( charStr.match(pattern) !== null )
        {
            processedName = processedName.concat(origName.charAt(i));            
        }
    }
    
    if(processedName.length === 0)
    {
        processedName = "Unknown";
    }
    
    return processedName;
}

function writeMetadataToDB( metadata )
{
    var uiArtist = metadata.metadata.artist.length > 0 ? metadata.metadata.artist[0] : "";
    
    var songTableParams = {
        TableName: process.env.DYNAMODB_MUSIC_TRACK_TABLE,
        Item: {
            "title": metadata.title,
            "artist": metadata.artist,
            "album": metadata.album,
            "trackNumber": metadata.trackNum,
            "ui_title": metadata.metadata.title,
            "ui_artist": uiArtist,
            "ui_album": metadata.metadata.album,
            "url": metadata.s3url
        }
    };
    
    docClient.put( songTableParams, function(err, data) {
        if (err)
            console.log(JSON.stringify(err, null, 2));
        else
            console.log(JSON.stringify(data, null, 2));
    } );
    
    var albumTableParams = {
        TableName: process.env.DYNAMODB_MUSIC_ALBUM_TABLE,
        Key: {
            "album": metadata.album,
            "artist": metadata.artist
        },
        UpdateExpression: "SET ui_artist = :uiartist, ui_album = :uialbum, tracks = list_append( if_not_exists(tracks, :empty_list), :i)",
        ExpressionAttributeValues: {
            ":uiartist": uiArtist,
            ":uialbum": metadata.metadata.album,
            ":i": [ { title: metadata.title, ui_title: metadata.metadata.title, trackNumber: metadata.trackNum, url: metadata.s3url } ],
            ":empty_list": []
        }
    };
    
    docClient.update( albumTableParams, function(err, data) {
        if (err)
            console.log(JSON.stringify(err, null, 2));
        else
            console.log(JSON.stringify(data, null, 2));
    } );
    
    
    var artistTableParams = {
        TableName: process.env.DYNAMODB_MUSIC_ARTIST_TABLE,
        Item: {
            "artist": metadata.artist,
            "title": metadata.title,
            "album": metadata.album,
            "ui_artist": uiArtist,
            "ui_album": metadata.metadata.album,
            "ui_title": metadata.metadata.title,
            "trackNumber": metadata.trackNum,
            "url": metadata.s3url
        }
    };
    
    docClient.put( artistTableParams, function(err, data) {
        if (err)
            console.log(JSON.stringify(err, null, 2));
        else
            console.log(JSON.stringify(data, null, 2));
    } );
}

exports.handler = function(event, context, callback)
{
    var srcBucket = event.Records[0].s3.bucket.name;
    var srcKey = decodeURIComponent(event.Records[0].s3.object.key.replace(/\+/g, " "));
    var outputKey = srcKey + ".mp3";
    var s3url = "https://s3.amazonaws.com/" + srcBucket + "/" + outputKey.replace(/\s/g, '+');
    
    // Read the audio metadata this will not be preserved by the elastic transcoder
    S3.getObject( { 
                    Bucket: srcBucket,
                    Key: srcKey
    },
    function (err, response) {
        if( err )
        {
            console.log(err);
        }
        else
        {           
            var readStream = streamifier.createReadStream( response.Body );
            
            var parser = MM( readStream, function(err, metadata ) {
                if (err)
                {
                    console.log(err);
                }
                else
                {
                    var trackPattern = new RegExp("[0-9]+");
                    
                    var title = preprocessName(metadata.title);
                    var artist = preprocessName(metadata.artist.length > 0 ? metadata.artist[0] : "");
                    var album = preprocessName(metadata.album);
                    var trackNum = trackPattern.exec(metadata.track.no)[0];
                    
                    var fileData = {
                        metadata: metadata,
                        title: title,
                        artist: artist,
                        album: album,
                        trackNum: trackNum,
                        s3url: s3url
                    };
                                       
                    writeMetadataToDB(fileData);
                }
            } );
        }
        
    } );
       
    var params = {
      PipelineId: process.env.PIPELINE_ID,
      Input: {
          Key: srcKey,
          Container: "auto"
      },
      Output: {
          Key: outputKey,
          PresetId: process.env.MP3_PRESET_ID
      },
      UserMetadata: {
          OriginalFileBucket: srcBucket,
          OriginalFileKey: srcKey
      }
    };
    
    elasticTranscoder.createJob( params, function(err, data) {
        if (err)
        {
            console.log(err);
        }
    } );
    
}
