#!/bin/bash

# Déterminer le chemin absolu de viu-fr.sh
PROJECT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
SCRIPT_PATH="$PROJECT_DIR/viu-fr.sh"

# Rendre le script exécutable (au cas où)
chmod +x "$SCRIPT_PATH"

# Détecter le shell (zsh ou bash)
SHELL_CONFIG=""
if [[ "$SHELL" == *"zsh"* ]]; then
    SHELL_CONFIG="$HOME/.zshrc"
elif [[ "$SHELL" == *"bash"* ]]; then
    SHELL_CONFIG="$HOME/.bashrc"
fi

if [[ -n "$SHELL_CONFIG" ]]; then
    # Vérifier si l'alias existe déjà
    if grep -q "alias viu-fr=" "$SHELL_CONFIG"; then
        echo "L'alias viu-fr existe déjà dans $SHELL_CONFIG."
    else
        echo "Ajout de l'alias viu-fr dans $SHELL_CONFIG..."
        echo "alias viu-fr='$SCRIPT_PATH'" >> "$SHELL_CONFIG"
        echo "Alias ajouté avec succès ! Redémarrez votre terminal ou lancez 'source $SHELL_CONFIG'."
    fi
else
    echo "Impossible de détecter votre fichier de configuration shell. Ajoutez manuellement :"
    echo "alias viu-fr='$SCRIPT_PATH'"
fi
