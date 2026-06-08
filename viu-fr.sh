#!/bin/bash
PROJECT_DIR="${VIU_FR_HOME:-$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )}"
cd "$PROJECT_DIR"
source venv/bin/activate
node dist/cli.js "$@"
