var bleproxy = function() {

	var util = require('util');
	var noble = require('noble');
	var bleno = require('bleno');
	var debug = require('debug')('bleproxy');

	var self = {};

	var connected_peripheral = null;

	var started = false;

	var scanning = false;
	
	var scan_uuids = null;

	var scan_matcher = null;

	var bleno_state = null;
	var noble_state = null;

	var notifyCallback = null;
	var indicateCallback = null;
	var connectCallback = null;

	self.on = function(event, fn) {
		if (event === 'stateChange') {
			noble.on(event, function(state) {
				noble_state = state;
				if (bleno_state === state) fn(state);
				});
			bleno.on(event, function(state) {
				bleno_state = state;
				if (noble_state === state) fn(state);
				});
			}
		if (event === 'notify') {
			notifyCallback = fn;
			}
		if (event === 'indicate') {
			indicateCallback = fn;
			}
		if (event === 'connect') {
			connectCallback = fn;
			}	
		};

	/*bleno.on('advertisingStart', function(error) {
	  debug('on -> advertisingStart: ' + (error ? 'error ' + error : 'success'));
	  });*/

	var prepareScnData = function(advertisement) {
		var buffer = new Buffer(31);
		buffer.fill(0x00);
		var position = 0;
		//buffer.writeUInt8(0x02, position++);
		//buffer.writeUInt8(0x01, position++);
		//buffer.writeUInt8(0x06, position++);
		if (advertisement.localName) {
			buffer[position++] = advertisement.localName.length + 1;
			buffer[position++] = 0x09;
			position += buffer.write(advertisement.localName, position, advertisement.localName.length);
			}
		buffer.writeUInt8(0x02, position++);
		buffer.writeUInt8(0x0a, position++);
		buffer.writeInt8(advertisement.txPowerLevel, position++);
		return buffer;
	}

	var prepareAdvData = function(advertisement) {
		var buffer = new Buffer(31);
		buffer.fill(0x00);
		var position = 0;
		buffer.writeUInt8(0x02, position++);
		buffer.writeUInt8(0x01, position++);
		buffer.writeUInt8(0x06, position++);
		if (advertisement.serviceUuids && advertisement.serviceUuids.length > 0) {
			for (i=0; i<advertisement.serviceUuids.length; i++) {
				var uuid = advertisement.serviceUuids[i].match(/.{1,2}/g).reverse().join('');
				if (uuid.length === 32) {
					if (i==0)
						{
						buffer[position++] = (advertisement.serviceUuids.length * 16) + 1;
						buffer[position++] = 0x07;
						}
					position += buffer.write(uuid, position, uuid.length, 'hex');
					}
				else {
					if (i==0) {
						buffer[position++] = (advertisement.serviceUuids.length * 2) + 1;
						buffer[position++] = 0x03;
						}
					position += buffer.write(uuid, position, uuid.length, 'hex');
					}
		
				}
			}
		if (advertisement.manufacturerData && advertisement.manufacturerData.length > 0) {
			buffer[position++] = advertisement.manufacturerData.length + 1;
			buffer[position++] = 0xff;
			advertisement.manufacturerData.copy(buffer, position);
			position += advertisement.manufacturerData.length;		
			}
		return buffer;
		}

	var createServiceProxy = function(uuid, characteristicProxies) {
		var ServiceProxy = function() {
  			ServiceProxy.super_.call(this, {
      			uuid: uuid,
      			characteristics: characteristicProxies
  			});
		};
		util.inherits(ServiceProxy, bleno.PrimaryService);
		return new ServiceProxy();
		}

	var createCharacteristicProxy = function(characteristic) {
		var CharacteristicProxy = function() {
  			CharacteristicProxy.super_.call(this, {
		    		uuid: characteristic.uuid,
				name: characteristic.name,
				type: characteristic.type,
		    		properties: characteristic.properties,
		    		descriptors: characteristic.descriptors
		  	});
		};
		util.inherits(CharacteristicProxy, bleno.Characteristic);
		CharacteristicProxy.prototype.onReadRequest = function(offset, callback) {
			debug("read request ", offset);
			var Characteristic = bleno.Characteristic;
			if (offset < 0) {
				callback(Characteristic.RESULT_INVALID_OFFSET);
				return;
				}
			characteristic.read(function(error, data) {
				if (error) {
					callback(Characteristic.RESULT_UNLIKELY_ERROR);
					return;
					}
				if (offset >= data.length) {
					callback(Characteristic.RESULT_INVALID_OFFSET);
					return;
					}
				if (offset > 0) {
					data = data.slice(offset);
					}
				debug("read request ", data);
				callback(Characteristic.RESULT_SUCCESS, data);
				});
 			};
		CharacteristicProxy.prototype.onWriteRequest = function(data, offset, withoutResponse, callback) {
			debug("write request", data, offset, withoutResponse);
			var Characteristic = bleno.Characteristic;
			if ((offset < 0) || (offset >= data.length)) {
				callback(Characteristic.RESULT_INVALID_OFFSET);
				return;
				}
			if (offset > 0) {
				data = data.slice(offset);
				}
			characteristic.write(data, withoutResponse, function(error) {
					if (error) callback(Characteristic.RESULT_UNLIKELY_ERROR);
					else callback(Characteristic.RESULT_SUCCESS);
				});
			};
		CharacteristicProxy.prototype.onNotify = function() {
			//debug("notify");
			};
		CharacteristicProxy.prototype.onIndicate = function() {
			//debug("indicate");
			};
		CharacteristicProxy.prototype.onSubscribe = function(maxValueSize, updateValueCallback) {
			debug("subscribe ", maxValueSize);
			characteristic.on('data', function(data, isNotification) {
				//debug('data');
				if (data.length<=maxValueSize) updateValueCallback(data);
				if (isNotification && notifyCallback) notifyCallback(data);
				if (!isNotification && indicateCallback) indicateCallback(data);
				});
			characteristic.subscribe();
			};
		CharacteristicProxy.prototype.onUnsubscribe = function() {
			debug("unsubscribe");
			characteristic.unsubscribe();
			characteristic.on('data', function(data, isNotification) {});
			};
		return new CharacteristicProxy();
		}

	noble.on('discover', function(peripheral) {
		if (!started) return;
		if (connected_peripheral) return;
		if (scan_matcher) if (!scan_matcher(peripheral)) return;
		//debug(peripheral);
		if (!peripheral.connectable) return;
		noble.stopScanning();
		var advertisement = peripheral.advertisement;
		connected_peripheral = peripheral;
		peripheral.once('disconnect', function() {
			if (!started) return;
			debug("backend disconnected");
			connected_peripheral = null;
			peripheral.disconnect();
			bleno.disconnect();
			bleno.stopAdvertising(function() {
				bleno.setServices([], function() {
					setTimeout(startScanning, 1000);
					});
				});
			});
		peripheral.once('connect', function(error) {
			if (error) {
				connected_peripheral = null;
				debug("connect error");
				return;
				}
    			debug('connected to peripheral : ' + peripheral.uuid);
			if (connectCallback) connectCallback(peripheral);
			peripheral.discoverServices([], function(error, services) {
				if (error) return;
				var serviceProxies = [];
				var count = 0;

				for (var i=0; i<services.length; i++) {
					var service = services[i];
					switch (service.uuid) {
					case '1800':
					case '1801':
						break;
					default:
						(function(service) {
							count++;
							var characteristicProxies = [];
							service.discoverCharacteristics([], function(error, characteristics) {
								if (error) return;
								//debug(service.uuid);
								count--;
								for (var j=0; j<characteristics.length; j++) {
									var c = characteristics[j];
									
									debug(c);
									var proxyCharacteristic = createCharacteristicProxy(c);

									characteristicProxies.push(proxyCharacteristic);
									}
								var serviceProxy = createServiceProxy(service.uuid, characteristicProxies);
								serviceProxies.push(serviceProxy);
								//debug(serviceProxy.characteristics);
								if (count==0) {
									bleno.setServices(serviceProxies, function(error){
										debug('bleproxy : setServices '  + (error ? 'error ' + error : 'success'));
										if (error) return;
										 var adv = prepareAdvData(advertisement);
										 var scn = prepareScnData(advertisement);
		                						bleno.startAdvertisingWithEIRData(adv, scn, function(error) {
										if (error) bleno.setServices([]);
										else debug("start advertising");
										
										
				    							});

										});

										}
								});
							})(service);
						}
					}
			});
	                /*var adv = prepareAdvData(advertisement);
			var scn = prepareScnData(advertisement);
                        bleno.startAdvertisingWithEIRData(adv, scn);
			debug("start advertising");*/
			});
		peripheral.connect();
 
		/*peripheral.connect(function(error) {
			if (error) {
				back_connected = false;
				debug("connect error");
				return;
				}
    			debug('connected to peripheral : ' + peripheral.uuid);
			noble.stopScanning();
	                var adv = prepareAdvData(advertisement);
			var scn = prepareScnData(advertisement);
                        bleno.startAdvertisingWithEIRData(adv, scn);
			debug("start advertising");
  			});*/
		});


	var startScanning = function (){
	        if (noble_state === 'poweredOn') {
			noble.startScanning(scan_uuids, true);
			debug("start scanning");
			}
		};
	
	self.start = function(uuids, matcher) {
		debug("start");
		started = true;
		scan_uuids = uuids;
		scan_matcher = matcher;
		if (!connected_peripheral) startScanning();
		};

	self.stop = function() {
		debug("stop");
		started = false;
		bleno.stopAdvertising();
		if (connected_peripheral) {
			connected_peripheral.disconnect();
			connected_peripheral = null;
			}
		};

	return self;
	}

module.exports = bleproxy();

