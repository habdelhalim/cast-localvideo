var express = require("express");
var fs = require("fs");
var path = require("path");
var spawn = require("child_process").spawn;
var ffmpeg = require('fluent-ffmpeg');
var os = require("os");
var async = require("async");
var bodyParser = require("body-parser");
var cookieParser = require("cookie-parser");
var morgan = require("morgan");

function convertBytesToHumanReadableString(bytes) {
	var values = ["B", "KB", "MB", "GB", "TB"];
	var i = 0;
	while (bytes > 1000) {
		bytes = bytes / 1000;
		i++;
	}
	return parseInt(bytes) + " " + values[i];
}

function get_stream(metadata, kind) {
    return metadata.streams.filter(function(s) {
	return s.codec_type === kind;
    })[0];
}

var app = express();
app.set('view engine', 'jade');
app.set('view options', {
	layout: false
});
app.use(bodyParser());
app.use(cookieParser());
app.use(morgan("dev"));
app.use(express.static(__dirname + '/public'));

var gui = function(req, res) {
	var interfaces = os.networkInterfaces();
	var rootDirectory = req.params[0] || process.env.HOME || process.env.HOMEPATH || process.env.USERPROFILE;
	res.render("index", {
		rootDirectory: rootDirectory,
		interfaces: interfaces
	});
}

app.get("/", gui);
app.param("path", function(){});
app.get( /^\/dir\/(.*)$/, gui);

app.get("/sample", function(req, res) {
	res.render("sample");
});


app.post("/folders", function(req, res) {
	var dir = req.body.dir;
	var entries = fs.readdirSync(dir);

	var folders = [];

	folders.push({
		path: path.join(dir, ".."),
		name: "Up"
	});

	for (var i in entries) {
		try {
			var p = path.join(dir, entries[i]);
			var stat = fs.statSync(p);
			if (stat.isDirectory()) {
				folders.push({
					path: p,
					name: require("path").basename(p)
				});
			}
		} catch (ex) {
			// Meh
		}
	}
	res.render("folders", {
		folders: folders
	});
});

function getFileType(path){
	var extension = require("path").extname(path);
	if (extension && extension.length && extension.length > 0) {					
		if (  /\b(wmv|mkv|avi|flv|mov|webm|3gp|mp4)$/i.test(extension) ){
			return "video";
		} else if (  /\b(mp3)$/i.test(extension) ){
			return "audio";
		} else if ( /\b(jpg|jpeg|png)$/i.test(extension)){
			return "image";
		} else {
			return null;
		}
	}
	return null;
}

app.post("/files", function(req, res) {
	var dir = req.body.dir;
	var entries = fs.readdirSync(dir);

	var files = [];

	for (var i in entries) {
		try {
			var p = path.join(dir, entries[i]);
			var stat = fs.statSync(p);
			if (stat.isFile()) {
				console.log(getFileType(p));
				files.push({
					filetype: getFileType(p),
					path: p,
					name: require("path").basename(p)
				});
			}
		} catch (ex) {
			// throw ex;
		}
	}


	async.map(files, function(item, callback) {
		try {
			fs.stat(item.path, function(err, stat) {
				// If error unreadable file
				if (err) {
					item.size = -1;
					callback(null, item);
				} else {
					item.size = convertBytesToHumanReadableString(stat.size);
					callback(null, item);
				}
			});
		} catch (err) {
			callback(null, item);
		}
	}, function(err, results) {
		res.render("files", {
			files: results
		});
	});

});


app.post("/getFile", function(req, res) {
	var dir = req.body.dir;
	res.sendFile(dir);
});

app.get("/getFile/*", function(req,res){
	var dir = req.url.split("/").splice(2).join("/");
	var buf = new Buffer(dir, 'base64');
	var src = buf.toString();
	res.sendfile(src);
});

app.get("/video/*", function(req, res) {
	// It may be wiser to encode it diffferently, since we can hit GET path limit, 2048 characters I guess
	var dir = req.url.split("/").splice(2).join("/");
	var buf = new Buffer(dir, 'base64');
	var src = buf.toString();

	var Transcoder = require('./transcoder.js');


  // Get the metadata
  ffmpeg.ffprobe(src, function(err, metadata) {
      // Start ffmpeg
      var stream = fs.createReadStream(src);
      var video = get_stream(metadata, 'video');

      // Feel free to change those, but libx264 is faster than vp8
      // A resize mechanism can be used
      var transcoder = new Transcoder(stream);
      (video.codec === "h264") ? transcoder.videoCodec('copy') : transcoder.videoCodec('libx264');

      res.writeHead(200, {
	  'Content-Type': 'video/mp4',
	  'X-Content-Duration': video.duration
      });

    transcoder.audioCodec("libvo_aacenc")
      .sampleRate(44100)
      .channels(2)
      .audioBitrate(128 * 1000)
      .format('mp4')
      .on('finish', function() {
        console.log("ffmpeg process finished");
      })
      .stream().pipe(res);
	});

});

app.post("/metadata", function(req, res) {
	var file = req.body.file;
	console.log("Metadata of", file, "requested");	
	var filetype = getFileType(file);
	if ( filetype == "video"){
		ffmpeg.ffprobe(file, function(err, metadata) {
		    metadata.path = file;
		    metadata.filetype = filetype;
		    res.render("metadata", {
			path: file,
			filetype: filetype,
			video: get_stream(metadata, 'video') || {
			    width: -1,
			    height: -1,
			    duration: -1,
			    bit_rate: -1,
			    codec_long_name: 'N/A'
			},
			audio: get_stream(metadata, 'audio') || {
			    bit_rate: -1,
			    codec_long_name: 'N/A'
			}
		    });
		});		
	} else {
		// No metada for mp3s/images yet :/
		var metadata = {};
		metadata.path = file;
		metadata.filetype = filetype;
		res.render("metadata", metadata);		
	}
});

console.log("Open http://localhost:8000/ at your Chrome browser.");
app.listen(8000);
