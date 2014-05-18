
var fs = require('fs');
var Computer = require('./computer');
var join = require('path').join;
var crypto = require('crypto');
var debug = require('debug')('computer:worker');

if (!process.env.COMPUTER_ISO) {
  console.log('You must specify the ENV variable `COMPUTER_ISO` ' +
      'to location of iso file to broadcast.');
  process.exit(1);
}

if (!process.env.COMPUTER_IMG) {
  console.log('Must specificy the ENV variable `COMPUTER_IMG` ' +
    'to location of disk image to use');
  process.exit(1);
}

process.title = 'socket.io-computer-emulator';

// redis
var redis = require('./redis').emu();
var sub = require('./redis').emu();
var io = require('socket.io-emitter')(redis, {key: 'xpemu'});

// iso
var iso = process.env.COMPUTER_ISO;
if ('/' != iso[0]) iso = join(process.cwd(), iso);
debug('iso %s', iso);

// img
var img = process.env.COMPUTER_IMG;
if ('/' != img[0]) img = join(process.cwd(), img);
debug('img %s', img);

var saveInterval = null;

// load computer emulator
var emu;

function load(){
  debug('loading emulator');
  emu = new Computer();

  emu.on('error', function() {
    console.log(new Date + ' - restarting emulator');
    emu.destroy();
    setTimeout(load, 1000);
  });

  var lastHash;

  emu.on('frame', function(frame) {
    if (!frame.length) return debug('ignore bogus frame');
    var hash = checksum(frame);
    if (hash == lastHash) return debug('ignore repeated frame');
    io.emit('frame', frame);
    redis.set('computer:frame', frame);
    lastHash = hash;
  });

  console.log('init emu');
  emu.init(img, iso);
  setTimeout(function() {
    console.log('run emu');
    emu.run();
  }, 2000);

  function save() {
    if (saveInterval) {
      debug('will save in %d', saveInterval);
      emu.snapshot('xpsnapshot.img');
      setTimeout(save, saveInterval);
    }
  }
}

// controlling
var curX = 0;
var curY = 0;

sub.subscribe('computer:keydown');
sub.subscribe('computer:mousemove');
sub.subscribe('computer:click');
sub.on('message', function(channel, data) {
  if ('computer:keydown' == channel) {
    emu.key(data.toString()); // data is a key for send_press
  } else if ('computer:mousemove' == channel) { // absolute x and y of client
    var split = data.toString().split(':');
    var x = parseInt(split[0], 10);
    var y = parseInt(split[1], 10);

    var dx = x - curX;
    var dy = y - curY;
    //console.log('move = ' + dx + ' || ' + dy);
    emu.mouse(dx, dy);

    curX = x;
    curY = y;
  } else if ('computer:click' == channel) {
    emu.click(data.toString()); // data is mouse pressed code for mouse_button
  }
});

function checksum(str){
  return crypto.createHash('md5').update(str).digest('hex');
}

load();
