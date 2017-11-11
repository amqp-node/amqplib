RABBITMQ_SRC_VERSION=rabbitmq_v3_2_1
JSON=amqp-rabbitmq-0.9.1.json
RABBITMQ_CODEGEN=https://raw.githubusercontent.com/rabbitmq/rabbitmq-codegen
AMQP_JSON=$(RABBITMQ_CODEGEN)/$(RABBITMQ_SRC_VERSION)/$(JSON)
NODEJS_VERSIONS='0.8' '0.9' '0.10' '0.11' '0.12' '1.6' '2.5' '3.3' '4.2' '5.5' '6.2' '8.9'

MOCHA=./node_modules/.bin/mocha
_MOCHA=./node_modules/.bin/_mocha
UGLIFY=./node_modules/.bin/uglifyjs
ISTANBUL=./node_modules/.bin/istanbul

.PHONY: test test-all-nodejs all clean coverage

all: lib/defs.js

clean:
	rm lib/defs.js bin/amqp-rabbitmq-0.9.1.json
	rm -rf ./coverage

lib/defs.js: $(UGLIFY) bin/generate-defs.js bin/amqp-rabbitmq-0.9.1.json
	(cd bin; node ./generate-defs.js > ../lib/defs.js)
	$(UGLIFY) ./lib/defs.js -o ./lib/defs.js \
		-c 'sequences=false' --comments \
		-b 'indent-level=2' 2>&1 | (grep -v 'WARN' || true)

test: lib/defs.js
	$(MOCHA) --check-leaks -u tdd test/

test-all-nodejs: lib/defs.js
	for v in $(NODEJS_VERSIONS); \
		do nave use $$v $(MOCHA) -u tdd -R progress test; \
		done

coverage: $(ISTANBUL) lib/defs.js
	$(ISTANBUL) cover $(_MOCHA) -- -u tdd -R progress test/
	$(ISTANBUL) report
	@echo "HTML report at file://$$(pwd)/coverage/lcov-report/index.html"

bin/amqp-rabbitmq-0.9.1.json:
	curl -L $(AMQP_JSON) > $@

$(ISTANBUL):
	npm install

$(UGLIFY):
	npm install
