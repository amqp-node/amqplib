RABBITMQ_SRC_VERSION=rabbitmq_v3_1_3
JSON=amqp-rabbitmq-0.9.1.json
RABBITMQ_CODEGEN=https://raw.github.com/rabbitmq/rabbitmq-codegen
AMQP_JSON=$(RABBITMQ_CODEGEN)/$(RABBITMQ_SRC_VERSION)/$(JSON)

MOCHA=./node_modules/mocha/bin/mocha
UGLIFY=./node_modules/uglify-js/bin/uglifyjs


.PHONY: test all clean

all: lib/defs.js

clean:
	rm lib/defs.js bin/amqp-rabbitmq-0.9.1.json

lib/defs.js: bin/generate-defs.js bin/amqp-rabbitmq-0.9.1.json
	(cd bin; node ./generate-defs.js > ../lib/defs.js)
	$(UGLIFY) ./lib/defs.js -o ./lib/defs.js \
		-c 'sequences=false' --comments \
		-b 'indent-level=2' 2>&1 | (grep -v 'WARN' || true)

test: lib/defs.js
	$(MOCHA) --ui tdd test

bin/amqp-rabbitmq-0.9.1.json:
	curl $(AMQP_JSON) > $@
