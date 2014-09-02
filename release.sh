#!/bin/sh

VERSION=`cat package.json | grep -oEi '[0-9]+.[0-9]+.[0-9]+' | head -1`

echo "# task-swarm"
echo "# Releasing: v$VERSION"

git tag -a "v$VERSION" -m "v$VERSION"
git push --tags > /dev/null
npm publish > /dev/null

echo "# Done!"
