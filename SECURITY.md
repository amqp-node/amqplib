# Security Policy

## Supported versions

Security fixes are released for the latest version of amqplib only. Earlier versions, including 0.x and 1.x, do not receive fixes.

## Reporting a vulnerability

Please report vulnerabilities privately through [GitHub security advisories](https://github.com/amqp-node/amqplib/security/advisories/new). Do not open a public issue or pull request.

Before reporting, please:

- Reproduce the problem against the [latest release](https://www.npmjs.com/package/amqplib). A report tested only against an older version is likely to describe something that has already been fixed.
- Check the [changelog](CHANGELOG.md) and the [published advisories](https://github.com/amqp-node/amqplib/security/advisories) for an existing fix.
- Say which version you tested, how to reproduce the problem, and what you observed.

## Threat model

amqplib connects to a broker that its user has chosen. It assumes that the broker, and the network between the client and the broker, are trusted. Use `amqps://` with certificate verification when the network is not.

### Problems that need a malicious broker or network

Some problems can only be triggered by a malicious or compromised broker, or by someone able to modify the traffic between the client and the broker. These are accepted as vulnerabilities, because a client is usually a long-running service and a crash can mean an outage or lost work.

They are also hard to exploit. An attacker must first gain that position, and one who has can already read, alter and withhold every message. They are therefore scored with high attack complexity (`AC:H` in CVSS 3.1), which makes a denial of service Medium severity at most.

### Problems that need only a message

A problem that can be triggered by the content of a message, such as its headers or properties, does not need a compromised broker. The message can come from any client with permission to publish to the broker, and these problems are scored accordingly.
