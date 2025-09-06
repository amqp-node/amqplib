//
//
//

// Different kind of credentials that can be supplied when opening a
// connection, corresponding to SASL mechanisms There's only two
// useful mechanisms that RabbitMQ implements:
//  * PLAIN (send username and password in the plain)
//  * EXTERNAL (assume the server will figure out who you are from
//    context, i.e., your SSL certificate)
const codec = require('./codec');

module.exports.plain = (user, passwd) => ({
  mechanism: 'PLAIN',
  response: () => Buffer.from(['', user, passwd].join(String.fromCharCode(0))),
  username: user,
  password: passwd,
});

module.exports.amqplain = (user, passwd) => ({
  mechanism: 'AMQPLAIN',
  response: () => {
    const buffer = Buffer.alloc(16384);
    const size = codec.encodeTable(buffer, { LOGIN: user, PASSWORD: passwd }, 0);
    return buffer.subarray(4, size);
  },
  username: user,
  password: passwd,
});

module.exports.external = () => ({
  mechanism: 'EXTERNAL',
  response: () => Buffer.from(''),
});
