const EventEmitter = require('node:events');

// Exported so that we can mess with it in tests
module.exports.UNITS_TO_MS = 1000;

class Heart extends EventEmitter {
  constructor(interval, checkSend, checkRecv) {
    super();

    this.interval = interval;

    const intervalMs = interval * module.exports.UNITS_TO_MS;
    // Function#bind is my new best friend
    const beat = this.emit.bind(this, 'beat');
    const timeout = this.emit.bind(this, 'timeout');

    this.sendTimer = setInterval(this.runHeartbeat.bind(this, checkSend, beat), intervalMs / 2);

    // A timeout occurs if I see nothing for *two consecutive* intervals
    let recvMissed = 0;
    function missedTwo() {
      if (!checkRecv()) return ++recvMissed < 2;
      else {
        recvMissed = 0;
        return true;
      }
    }
    this.recvTimer = setInterval(this.runHeartbeat.bind(this, missedTwo, timeout), intervalMs);
  }

  clear() {
    clearInterval(this.sendTimer);
    clearInterval(this.recvTimer);
  }

  runHeartbeat(check, fail) {
    // Have we seen activity?
    if (!check()) fail();
  }
}

module.exports.Heart = Heart;
