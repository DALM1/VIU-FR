#!/bin/bash

# Chemin absolu du projet
PROJECT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"

# Activation du venv et lancement de l'app
cd "$PROJECT_DIR"
source venv/bin/activate
node dist/cli.js
