RABBITMQ_SRC_VERSION=rabbitmq_v3_1_1
JSON=amqp-rabbitmq-0.9.1.json
RABBITMQ_CODEGEN=https://raw.github.com/rabbitmq/rabbitmq-codegen
MOCHA=./node_modules/mocha/bin/mocha
UGLIFY=./node_modules/uglify-js/bin/uglifyjs
UGLIFY_OPTS='indent-level=2'

.PHONY: test all

all: lib/defs.js

lib/defs.js: ./Makefile bin/generate-defs.js bin/amqp-rabbitmq-0.9.1.json
	(cd bin; node ./generate-defs.js > ../lib/defs.js)
	$(UGLIFY) ./lib/defs.js -o ./lib/defs.js \
		-c 'sequences=false' \
		-b 'indent-level=2' 2>&1 | (grep -v 'WARN' || true)

test: lib/defs.js
	$(MOCHA) --ui tdd test

bin/amqp-rabbitmq-0.9.1.json:
	curl $(RABBITMQ_CODEGEN)/$(RABBITMQ_SRC_VERSION)/$(JSON) > $@
