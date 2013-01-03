.PHONY: test all

all: lib/defs.js

lib/defs.js: bin/generate-defs.js
	(cd bin; node ./generate-defs.js > ../lib/defs.js)

test: lib/defs.js
	./node_modules/mocha/bin/mocha --ui exports test
