#!/bin/bash

# Couleurs pour l'affichage
GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}=======================================${NC}"
echo -e "${BLUE}   INSTALLATION AUTOMATIQUE VIU-FR     ${NC}"
echo -e "${BLUE}=======================================${NC}"

# 1. Vérification des prérequis système
echo -e "\n${BLUE}[1/5] Vérification des outils système...${NC}"

check_cmd() {
    if ! command -v "$1" &> /dev/null; then
        echo -e "${RED}Erreur: $1 n'est pas installé.${NC} ($2)"
        return 1
    else
        echo -e "${GREEN}✔ $1 est présent.${NC}"
        return 0
    fi
}

MISSING=0
check_cmd "node" "Node.js est requis pour le TUI" || MISSING=1
check_cmd "python3" "Python 3 est requis pour le scraper" || MISSING=1
check_cmd "mpv" "mpv est requis pour le streaming (brew install mpv)" || MISSING=1
check_cmd "chafa" "chafa est requis pour les images (brew install chafa)" || MISSING=1
check_cmd "yt-dlp" "yt-dlp est requis pour le téléchargement (brew install yt-dlp)" || MISSING=1

if [ $MISSING -eq 1 ]; then
    echo -e "\n${RED}Certains outils manquent. Veuillez les installer avant de continuer.${NC}"
    exit 1
fi

# 2. Installation des dépendances Node.js
echo -e "\n${BLUE}[2/5] Installation des dépendances Node.js...${NC}"
npm install
npm run build

# 3. Configuration de l'environnement Python
echo -e "\n${BLUE}[3/5] Configuration de l'environnement Python (venv)...${NC}"
if [ ! -d "venv" ]; then
    python3 -m venv venv
    echo -e "${GREEN}✔ Environnement virtuel créé.${NC}"
else
    echo -e "${GREEN}✔ Environnement virtuel déjà existant.${NC}"
fi

source venv/bin/activate
echo -e "Installation des packages Python..."
pip install --upgrade pip
pip install curl_cffi beautifulsoup4 googlesearch-python duckduckgo-search anilist-python
echo -e "${GREEN}✔ Dépendances Python installées.${NC}"

# 4. Préparation du script de lancement
echo -e "\n${BLUE}[4/5] Préparation du script de lancement...${NC}"
PROJECT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
SCRIPT_PATH="$PROJECT_DIR/viu-fr.sh"

cat <<EOF > "$SCRIPT_PATH"
#!/bin/bash
PROJECT_DIR="$PROJECT_DIR"
cd "\$PROJECT_DIR"
source venv/bin/activate
node dist/cli.js
EOF

chmod +x "$SCRIPT_PATH"
echo -e "${GREEN}✔ Script viu-fr.sh prêt.${NC}"

# 5. Configuration de l'alias global
echo -e "\n${BLUE}[5/5] Configuration de l'alias global...${NC}"
SHELL_CONFIG=""
if [[ "$SHELL" == *"zsh"* ]]; then
    SHELL_CONFIG="$HOME/.zshrc"
elif [[ "$SHELL" == *"bash"* ]]; then
    SHELL_CONFIG="$HOME/.bashrc"
fi

if [[ -n "$SHELL_CONFIG" ]]; then
    if grep -q "alias viu-fr=" "$SHELL_CONFIG"; then
        # Mise à jour si le chemin a changé
        sed -i '' "s|alias viu-fr=.*|alias viu-fr='$SCRIPT_PATH'|g" "$SHELL_CONFIG"
        echo -e "${GREEN}✔ Alias viu-fr mis à jour dans $SHELL_CONFIG.${NC}"
    else
        echo "alias viu-fr='$SCRIPT_PATH'" >> "$SHELL_CONFIG"
        echo -e "${GREEN}✔ Alias viu-fr ajouté dans $SHELL_CONFIG.${NC}"
    fi
else
    echo -e "${RED}Impossible de détecter votre shell. Ajoutez manuellement :${NC}"
    echo "alias viu-fr='$SCRIPT_PATH'"
fi

echo -e "\n${GREEN}=======================================${NC}"
echo -e "${GREEN}      INSTALLATION TERMINÉE            ${NC}"
echo -e "${GREEN}=======================================${NC}"
echo -e "Redémarrez votre terminal ou lancez: ${BLUE}source $SHELL_CONFIG${NC}"
echo -e "Ensuite, tapez simplement: ${BLUE}viu-fr${NC}"
