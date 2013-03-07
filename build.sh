#!/bin/sh

rm -rf lib
./src/util/buildScripts/build.sh --profile package.js
rm ./lib/parking-client/resources/*.styl