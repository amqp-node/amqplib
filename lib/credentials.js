//
//
//

// Different kind of credentials that can be supplied when opening a
// connection, corresponding to SASL mechanisms There's only two
// useful mechanisms that RabbitMQ implements:
//  * PLAIN (send username and password in the plain)
//  * EXTERNAL (assume the server will figure out who you are from
//    context, i.e., your SSL certificate)
import * as codec from './codec.js'

export function plain(username, password) {
  return {
    mechanism: 'PLAIN',
    response() {
      return Buffer.from(['', username, password].join(String.fromCharCode(0)))
    },
    username,
    password
  }
}

export function amqplain(username, password) {
  return {
    mechanism: 'AMQPLAIN',
    response() {
      const buffer = Buffer.alloc(16384);
      const size = codec.encodeTable(buffer, { LOGIN: username, PASSWORD: password}, 0);
      return buffer.subarray(4, size);
    },
    username,
    password
  }
}

export function external() {
  return {
    mechanism: 'EXTERNAL',
    response() { return Buffer.from(''); }
  }
}
