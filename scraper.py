from curl_cffi import requests
from bs4 import BeautifulSoup
import sys
import json
import re
from urllib.parse import quote_plus
from googlesearch import search
import os
import subprocess
import tempfile

class UniversalAnimeScraper:
    def __init__(self):
        self.session = requests.Session()
        self.headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
        }

    def _get(self, url, referer=None, impersonate="chrome110"):
        headers = self.headers.copy()
        if referer:
            headers["Referer"] = referer
        try:
            response = self.session.get(url, headers=headers, impersonate=impersonate, timeout=20)
            return response
        except Exception as e:
            print(f"Error fetching {url}: {e}", file=sys.stderr)
            return None

    def query_anilist(self, search_query):
        """Récupère les métadonnées globales via l'API GraphQL d'AniList."""
        query = '''
        query ($search: String) {
          Page(perPage: 5) {
            media(search: $search, type: ANIME) {
              id
              title {
                romaji
                english
                native
              }
              description
              coverImage {
                large
              }
              genres
              averageScore
              status
              episodes
              bannerImage
            }
          }
        }
        '''
        variables = {'search': search_query}
        url = 'https://graphql.anilist.co'

        try:
            response = self.session.post(url, json={'query': query, 'variables': variables}, timeout=10)
            if response.status_code == 200:
                data = response.json()
                return data['data']['Page']['media']
        except Exception as e:
            print(f"AniList API error: {e}", file=sys.stderr)
        return []

    def search_anime(self, query):
        """Recherche hybride: AniList pour les infos + VostFree pour les sources VF."""
        anilist_results = self.query_anilist(query)

        final_results = []
        for media in anilist_results:
            title_eng = media['title']['english'] or media['title']['romaji']
            title_rom = media['title']['romaji']

            vf_url = self._find_vf_source(title_eng) or self._find_vf_source(title_rom)

            final_results.append({
                "id": media['id'],
                "title": title_eng,
                "romaji": title_rom,
                "poster": media['coverImage']['large'],
                "synopsis": media['description'],
                "genres": media['genres'],
                "score": media['averageScore'],
                "status": media['status'],
                "total_episodes": media['episodes'],
                "url": vf_url or f"SEARCH_ENG:{title_eng}"
            })

        return final_results

    def _find_vf_source(self, title):
        """Cherche une URL VostFree pour un titre donné."""
        search_url = "https://vostfree.ws/index.php?do=search"
        data = {"do": "search", "subaction": "search", "story": title}
        try:
            response = self.session.post(search_url, data=data, headers=self.headers, impersonate="chrome110", timeout=15)
            if response and response.status_code == 200:
                soup = BeautifulSoup(response.text, 'html.parser')
                for a in soup.find_all('a', href=True):
                    href = a['href']
                    if (('-vf' in href.lower() or '-vostfr' in href.lower()) and '.html' in href):
                        link_text = a.text.strip().lower()
                        if title.lower() in link_text or title.lower().replace(' ', '-') in href.lower():
                            return href if href.startswith('http') else "https://vostfree.ws" + href
        except: pass
        return None

    def get_anime_info(self, anime_url):
        """Récupère les épisodes."""
        if anime_url.startswith("SEARCH_ENG:"):
            title = anime_url.replace("SEARCH_ENG:", "")
            return {
                "title": title,
                "episodes": [{"title": f"Episode {i+1} (ENG SUB/DUB)", "url": f"SEARCH_STREAM_ENG:{title} episode {i+1}"} for i in range(12)]
            }

        response = self._get(anime_url)
        if not response or response.status_code != 200: return {"episodes": []}

        soup = BeautifulSoup(response.text, 'html.parser')
        episodes = []

        select = soup.find('select', class_='new_player_selector')
        if select:
            for opt in select.find_all('option'):
                episodes.append({
                    "title": opt.text.strip(),
                    "url": anime_url + "#" + opt['value']
                })

        if not episodes:
            for btn in soup.find_all(['div', 'a', 'span'], class_=re.compile(r'button|episode|play')):
                text = btn.text.strip()
                if text.isdigit() or 'episode' in text.lower():
                    url = btn.get('href') or btn.get('data-url')
                    if url:
                        episodes.append({
                            "title": f"Épisode {text}",
                            "url": url if url.startswith('http') else "https://vostfree.ws" + url
                        })
        return {"episodes": episodes}

    def get_stream_links(self, episode_url):
        """Récupère les liens de streaming."""
        if episode_url.startswith("SEARCH_STREAM_ENG:"):
            query = episode_url.replace("SEARCH_STREAM_ENG:", "")
            links = []
            try:
                for url in search(f'"{query}" stream yourupload', num_results=3):
                    if 'yourupload.com' in url:
                        res = self.resolve_stream(url)
                        if res: links.append(res)
            except: pass
            return links

        base_url = episode_url.split('#')[0]
        player_id = episode_url.split('#')[1] if '#' in episode_url else None

        response = self._get(base_url)
        resolved_links = []
        if response and response.status_code == 200:
            text = response.text
            all_links = re.findall(r'https?://(?:www\.)?(?:yourupload\.com|sibnet\.ru|ok\.ru|mystream\.to|upstream\.to|embed\.|player\.|stream\.)[^\s\'\"<>]+', text)
            if player_id:
                player_match = re.search(fr'id="{player_id}"[^>]*>.*?id="player_(\d+)"', text, re.DOTALL)
                if player_match:
                    p_id = player_match.group(1)
                    content_match = re.search(fr'id="content_player_{p_id}"[^>]*>(\d+)<', text)
                    if content_match:
                        sibnet_id = content_match.group(1)
                        all_links.append(f"https://video.sibnet.ru/shell.php?videoid={sibnet_id}")

            for link in all_links:
                link = link.replace('\\', '')
                res = self.resolve_stream(link)
                if res and res not in resolved_links:
                    resolved_links.append(res)

        return list(set(resolved_links))

    def resolve_stream(self, url):
        """Résout un lien YourUpload en lien direct mp4."""
        if "yourupload.com" in url:
            embed_url = url.replace("/watch/", "/embed/")
            res = self._get(embed_url)
            if res and res.status_code == 200:
                match = re.search(r'og:video"\s+content="([^"]+)"', res.text)
                if match: return match.group(1)
        return url

    def download_video(self, url, output_path):
        """Utilise yt-dlp pour télécharger la vidéo."""
        try:
            subprocess.run(['yt-dlp', '-o', output_path, url], check=True)
            return True
        except:
            return False

    def get_poster_art(self, url, width=40, height=20):
        """Télécharge le poster et le convertit en ASCII via chafa."""
        try:
            response = self._get(url)
            if response and response.status_code == 200:
                with tempfile.NamedTemporaryFile(delete=False, suffix='.jpg') as tmp:
                    tmp.write(response.content)
                    tmp_path = tmp.name

                try:
                    # On utilise les blocs standards les plus compatibles pour éviter les "?"
                    # chafa --symbols block (compatible partout, même Apple Terminal)
                    # --color-space 256 pour la compatibilité maximale
                    cmd = ['chafa', f'--size={width}x{height}', '--symbols=block', '--color-space=256', '--dither=none', tmp_path]
                    result = subprocess.run(cmd, capture_output=True, text=True)
                    os.unlink(tmp_path)
                    return result.stdout
                except Exception as e:
                    if os.path.exists(tmp_path): os.unlink(tmp_path)
                    return f"Chafa error: {e}"
        except Exception as e:
            return f"Download error: {e}"
        return "No image found"

if __name__ == "__main__":
    scraper = UniversalAnimeScraper()
    action = sys.argv[1]
    if action == "search":
        print(json.dumps(scraper.search_anime(sys.argv[2]), indent=2))
    elif action == "info":
        print(json.dumps(scraper.get_anime_info(sys.argv[2]), indent=2))
    elif action == "stream":
        print(json.dumps(scraper.get_stream_links(sys.argv[2]), indent=2))
    elif action == "download":
        success = scraper.download_video(sys.argv[2], sys.argv[3])
        print(json.dumps({"success": success}))
    elif action == "poster":
        # python scraper.py poster <url> [width] [height]
        w = int(sys.argv[3]) if len(sys.argv) > 3 else 40
        h = int(sys.argv[4]) if len(sys.argv) > 4 else 20
        print(scraper.get_poster_art(sys.argv[2], w, h))
