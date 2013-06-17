//
//
//

// Heartbeats. In AMQP both clients and servers may expect a heartbeat
// frame if there is no activity on the connection for a negotiated
// period of time. If there's no activity for two such intervals, the
// server or client is allowed to close the connection on the
// assumption that the other party is dead.
//
// So the client has two jobs here: the first is to send a heartbeat
// frame if it's not sent any frames for a while, so that the server
// doesn't think it's dead; the second is to check periodically that
// it's seen activity from the server, and to advise if there doesn't
// appear to have been any for over two intervals.
//
// Node.JS timers are a bit unreliable, in that they endeavour only to
// fire at some indeterminate point *after* the given time (rather
// gives the lie to 'realtime', dunnit). Because the scheduler is just
// an event loop, it's quite easy to delay timers indefinitely by
// reacting to some I/O with a lot of computation.
//
// To mitigate this I need a bit of creative interpretation:

//  - I'll schedule a server activity check for every `interval`, and
//    check just how much time has passed; if it overshoots, which it
//    always will by at least a small margin (modulo missing timer
//    deadlines, it'll notice between two and three intervals after
//    activity actually stops), OK it won't detect a failed heartbeat
//    *straight* away.
//
//  - Every `interval / 2` I'll check that we've sent something since
//    the last check, and if not, send a heartbeat frame. If we're
//    really too busy to even run the check for two whole heartbeat
//    intervals, there must be a lot of I (but not O, at least not on
//    the connection), or computation, in which case perhaps it's best
//    the server cuts us off anyway. Why `interval / 2`? Because the
//    edge case is that the client sent a frame just after a
//    heartbeat, which would mean I only send one after almost two
//    intervals.

// %% Yes, I could apply the same 'actually passage of time' thing to
// %% send as well as to recv.

var inherits = require('util').inherits;
var EventEmitter = require('events').EventEmitter;

function Heart(interval, checkSend, checkRecv) {
  EventEmitter.call(this);
  this.interval = interval;

  this.lastActivity = process.hrtime();
  function checkRecvPrecise() {
    if (checkRecv()) {
      this.lastActivity = process.hrtime();
      return true;
    }
    else {
      var since = process.hrtime(this.lastActivity);
      return (since[0] > this.interval * 2);
    }
  }

  var beat = this.emit.bind(this, 'beat');
  var timeout = this.emit.bind(this, 'timeout');

  this.sendTimer = setInterval(
    this.runHeartbeat.bind(this, checkSend, beat),
    this.interval * 500);

  this.recvTimer = setInterval(
    this.runHeartbeat.bind(this, checkRecvPrecise, timeout),
    this.interval * 1000);
}
inherits(Heart, EventEmitter);

module.exports.Heart = Heart;

Heart.prototype.clear = function() {
  clearInterval(this.sendTimer);
  clearInterval(this.recvTimer);
};

Heart.prototype.runHeartbeat = function(check, fail) {
  // Have we seen activity?
  if (!check()) fail();
};
