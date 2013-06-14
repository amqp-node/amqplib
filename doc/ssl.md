---
layout: default
title: SSL guide
---
# Using SSL/TLS

## Synopsis

```javascript
var opts = {
  cert: certificateAsBuffer,      // client cert
  key: privateKeyAsBuffer,        // client key
  passphrase: 'MySecretPassword', // passphrase for key
  ca: [caCertAsBuffer]            // array of trusted CA certs
};

var open = require('amqplib').connect('amqps://localhost', opts);
open.then(function(conn) {
  // ... go to town
}).then(null, console.warn);
```

See also the [SSL example][ssl-example].

## Certificates

Usually SSL is used for two reasons: to encrypt communications, and to
verify the communicating parties. For the latter purpose, the client
and server exchange certificates, then each decide if they trust one
another's identity by checking who has signed the certificate (the
Certificate Authority, or CA).

The general idea is that there are root CAs that are inherently
trusted; a certificate that can be traced back to a root CA is
transitively trusted. Since it usually costs a wad of money to get a
properly signed certificate, for some purposes it easier and cheaper
to use self-signed certificates; this is like creating a new root CA
just for your own use.

If you wish to use SSL *only* to encrypt communications, you should
*not* use a client certificate. The server will likely be configured
with a certificate, however; if it is a self-signed certificate you'll
need to supply the CA cert in the `ca` option.

## Configuring RabbitMQ for SSL connections

The RabbitMQ documentation has a step-by-step guide to getting
RabbitMQ to listen for SSL connections. In essence, the procedure is:

 - Create a self-signed CA cert
 - Create a server certificate and sign it with the CA
 - Create a client certificate and sign it with the CA
 - Tell RabbitMQ to use the server cert, and to trust the CA
 - Tell the client to use the client cert, and to trust the CA

If you have fancy CA-signed certificates already, you can of course
skip those initial steps (which is most of the faff).

Verification in RabbitMQ is governed by two configuration settings:
`fail_if_no_peer_cert` and `verify`. The first says what happens if
the client can't supply a certificate; if you want only encryption,
this should be `false`. The second says whether to make sure any
certificate that *is* presented, is trusted; if you are planning to
use client certificates, you should set this to `verify_peer`,
otherwise `verify_none`.

## Connecting the client via SSL

To connect to an SSL-enabled server, you must use a URL starting with
`'amqps://'` (note 's'), and supply an options object which will be
passed through to [`tls.connect()`][tls-connect-doc]. The particular
options you need depend on whether you are using a client certificate.

With a client certificate, you need to provide the certificate and its
corresponding secret key (in order to prove its yours); often the
secret key will be protected by a passphrase, too, if so you need to
provide that as well. Lastly, if the server is using a self-signed
certificate, you'll need its CA certificate.

The certificates and keys are supplied as byte buffers or strings, and
generally obtained from files; it's usually easiest, therefore, to
just read the files into buffers synchronously (they're not big, and
you only need to do it once):

```javascript
var opts = {
  cert: fs.readFileSync('clientcert.pem'),
  key: fs.creadFileSync('clientkey.pem'),
  passphrase: 'MySecretPassword',
  ca: [fs.readFileSync('cacert.pem')]
};
```

Note the CA cert goes in an array; you can supply more than one.

Usually certificates and keys are in `PEM` files. Sometimes the
certificate and key are combined in a `pkcs12` file instead; in which
case, dispense with `cert` and `key` and use `pfx` instead:

```javascript
var opts = {
  pfx: fs.readFileSync('clientcertkey.p12'),
  passphrase: 'MySecretPassword',
  ca: [fs.readFileSync('cacert.pem')]
};
```

Then give the options to the `connect()` function along with the URL:

```javascript
var open = amqp.connect('amqps://localhost', opts);
```

and continue as normal.

### Not using a client certificate

If you're not going to use a client certificate, you need only to make
sure you will trust the server certificate:

```javascript
var opts = {
  ca: [fs.readFileSync('cacert.pem')]
};
```

## Common problems

You can easily see the cause of a failure to connect by supplying
e.g., console.warn as the failure continuation to `connect()`:

```javascript
var open = amqp.connect(url, opts);
open.then(null, console.warn);
```

A very useful tool for seeing what's happening is `openssl
s_client`. For example,

    openssl s_client -connect example.com:5671

will tell you about the certificate `example.com` supplies when you
connect.

### [Error: SELF_SIGNED_CERT_IN_CHAIN]

This usually means you don't trust the server certificate. Check that
you're supplying the right CA certificate in the `ca` option.

### [Error: Hostname/IP doesn't match certificate's altnames]

The hostname you gave in the URL when connecting doesn't match that of
the certificate supplied by the server. To check what the server says,
you can use `openssl s_client`, e.g.,

    openssl s_client -connect example.com:5671

The value you're looking to match is the CN of the server certificate;
look for something like `subject=/CN=example.com/O=Example`. If
testing things locally, it may be that the server cert got a FQDN but
you're connecting to `'amqps://localhost'`.

### [Error: connect ECONNREFUSED]

The server isn't listening on the port you specified. If you didn't
mention a port, it defaults to `5671` for `amqps` connections.

### [Error: ... handshake failure: ...]

Probably means you failed to provide a client certificate and the
server was expecting one.

### [Error: ... unknown ca: ...]

The server doesn't recognise the CA that signed your client
certificate. Make sure the server is told the CA certificate file you
used to sign the client certificate, if it's self-signed.


[ssl-example]: https://github.com/squaremo/amqp.node/blob/master/examples/ssl.js
[tls-connect-doc]: http://nodejs.org/api/tls.html#tls_tls_connect_options_callback
