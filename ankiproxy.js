var proxy = require('./bleproxy');
var fs = require('fs');
var http = require('http');
var debug = require('debug')('ankiproxy');

process.stdin.resume();

var carName = process.argv[2];

var getCarIdFromName = function(carName) {
	var carId = -1;
	switch (carName) {
			case 'Ground Shock' :
				carId = 0x08;
				break;
			case 'Skull' :
				carId = 0x09;
				break;
			case 'Thermo' :
				carId = 0x0a;
				break;
			case 'Guardian' :
				carId = 0x0c;
				break;
		}
	return carId;
}

var carId = getCarIdFromName(carName);

var carMatcher = function(peripheral) {
	var mData = peripheral.advertisement.manufacturerData;
	if (mData[0] != 0xbe) return false;
	if (mData[1] != 0xef) return false;
	if (mData[2] != 0x00) return false;
	if (mData[3] == carId) return true;
	else return false;
}

proxy.on('stateChange', function(state) {
	  if (state === 'poweredOn') {
	    debug("bluetooth is on");
	    proxy.start(["be15beef6186407e83810bd89c4d8df4"], carMatcher);
	  } else {
	    debug("bluetooth is off");
	    proxy.stop();
	  }
	});

var deviceAddress = null;

proxy.on('connect', function(peripheral) {
	deviceAddress = peripheral.address;
	});

var getPiId = function() {
	return fs.readFileSync('/home/pi/setup/PiId.dat');
}

var getDemoZone = function() {
	return fs.readFileSync('/home/pi/setup/demozone.dat');
}

var getRaceStatus = function() {
	return fs.readFileSync('/home/pi/setup/race_status.dat');
}

var getRaceCount = function() {
	return parseInt(fs.readFileSync('/home/pi/setup/race_count.dat'));
}

var getRaceLap = function() {
	return parseInt(fs.readFileSync('/home/pi/setup/race_lap_' + carName + '.dat'));
}

var setRaceLap = function(lap) {
	fs.writeFileSync('/home/pi/setup/race_lap_' + carName + '.dat', lap);
}

var incRaceLap = function() {
	var lap = getRaceLap();
	if (lap==null) lap = 0;
	lap++;
	setRaceLap(lap);
	return lap;
}

var createTimestampString = function() {
  return new Date().toISOString().
  replace(/T/, ' ').
  replace(/\..+/, '').
  replace(/-/g, '/');
}

var createTimestampInt = function() {
	return Math.floor(new Date() / 1000);
}

var LAPURI = "/iot/send/data/urn:oracle:iot:device:data:anki:car:lap"
var SPEEDURI = "/iot/send/data/urn:oracle:iot:device:data:anki:car:speed"
var TRANSITIONURI = "/iot/send/data/urn:oracle:iot:device:data:anki:car:transition"
var OFFTRACKURI = "/iot/send/alert/urn:oracle:iot:device:event:anki:car:offtrack"

var postData = function(url, jsonData) {
	var client = http.createClient(8888, 'localhost');
	var request = client.request('POST', url,
	{'host': 'localhost',  'content-type': 'application/json'});
	request.end(JSON.stringify(jsonData));
}

var MSGID = 1;
var TRACKLOCATION = MSGID + 1;
var TRACKID = MSGID + 2;
var SPEED = MSGID + 8;
var POSITION = MSGID + 1;

var lastKnownPosition = 0x00;
var finishLineEvent = false;

var previousLapTime = 0;

var processLap = function () {

var timeNow = new Date().getTime();

if(previousLapTime == 0) {
	previousLapTime = timeNow;
	return;
	}

lapTime = timeNow - previousLapTime;

if(lapTime < 3000) return;

var currentLap = incRaceLap();
var raceStatus = getRaceStatus();
var demoZone = getDemoZone();
var raceCount = getRaceCount();
var piId = getPiId();
var jsonData = {
	demozone: demoZone,
	deviceId: piId,	
	dateTime: createTimestampInt(),
	dateTimeString: createTimestampString(),
	raceStatus: raceStatus,
	raceId: raceCount,
	carId: deviceAddress,
	carName: carName,
	lap: currentLap,	
	lapTime: lapTime
	};
postData(LAPURI, jsonData);

}

proxy.on('notify', function(data) {
	//debug("notify ", data);
	var msgId = data[MSGID];
	switch(msgId) {
		case 0x27:
			{
			if (data.length <= SPEED) break;
			var trackLocation = data[TRACKLOCATION];
                        var trackId = data[TRACKID];
                        var speed = (data[SPEED]<<8 | data[SPEED - 1]) * 5;
			debug("car localization ", trackLocation, trackId, speed);

			var raceStatus = getRaceStatus();
			var demoZone = getDemoZone();
			var raceCount = getRaceCount();
			var currentLap = getRaceLap();
			var piId = getPiId();

                        var jsonData = {
				demozone: demoZone,
				deviceId: piId,
				dateTime: createTimestampInt(),
				dateTimeString: createTimestampString(),
				raceStatus: raceStatus,
				raceId: raceCount,
				carId: deviceAddress,
				carName: carName,
				speed: speed,
				trackId: trackId,
				lap: currentLap
				};
			postData(SPEEDURI, jsonData);


			if (trackId == 34) if(!finishLineEvent) {
				// Finish Line Event
				debug("finish line event");
				processLap();
				finishLineEvent = true;
				}
			}			
			break;
		case 0x29:
			{
			var newPosition = data[POSITION];
			debug('car track position ', newPosition);
			switch(newPosition) {
				case 0x01:
				case 0x02:
				case 0x03:
					if (!finishLineEvent) {
						if (lastKnownPosition > (newPosition + 4) || (lastKnownPosition==0)) {
							debug("finish line event skipped workaround");
							// Looks like Finish Line Event was skipped
							processLap();
							}
						}
					break;
				}
			lastKnownPosition = newPosition;
			finishLineEvent = false;
			}
			break;
		case 0x32:
			debug("car u-turn");
			break;
		case 0x2b:
			{
			debug("car offtrack");
			var tentativeOfftrackPosition = lastKnownPosition - 3;
                   	if (tentativeOfftrackPosition < 0) tentativeOfftrackPosition = 0;
			var raceStatus = getRaceStatus();
			var demoZone = getDemoZone();
			var raceCount = getRaceCount();
			var currentLap = getRaceLap();
			var piId = getPiId();


			var jsonData = {
				demozone: demoZone,
				deviceId: piId,	
				dateTime: createTimestampInt(),
				dateTimeString: createTimestampString(),
				raceStatus: raceStatus,
				raceId: raceCount,
				carId: deviceAddress,
				carName: carName,
				lap: currentLap,
				message: "Off Track",	
				lastKnownTrack: tentativeOfftrackPosition
				};
			postData(LAPURI, jsonData);
			}
			break;
		default:
			break;
		}
	});

proxy.on('indicate', function(data) {
	debug("indicate ", data);
	});

process.on('SIGINT', function () {
	debug('got SIGINT');
	proxy.stop();
	process.exit();
	});

process.on('SIGTERM', function () {
	debug('got SIGTERM');
	proxy.stop();
	process.exit();
	});
