#!/bin/sh
# bump the service-worker cache name from the content hash (run before pushing)
cd "$(dirname "$0")" && H=$(cat docs/js/*.js docs/css/app.css docs/index.html | sha256sum | cut -c1-10) && sed -i "s/const CACHE = 'citrus-maxima-[^']*';/const CACHE = 'citrus-maxima-$H';/" docs/sw.js && echo "sw cache: citrus-maxima-$H"
