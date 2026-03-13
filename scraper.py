from curl_cffi import requests
from bs4 import BeautifulSoup
import sys
import json
import re
from urllib.parse import quote_plus
from googlesearch import search

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

    def resolve_stream(self, url):
        """Résout un lien YourUpload en lien direct mp4."""
        if "yourupload.com" in url:
            embed_url = url.replace("/watch/", "/embed/")
            res = self._get(embed_url)
            if res and res.status_code == 200:
                match = re.search(r'og:video"\s+content="([^"]+)"', res.text)
                if match: return match.group(1)
                match = re.search(r'file:\s*[\'"](https?://[^\'"]+\.mp4[^\'"]*)[\'"]', res.text)
                if match: return match.group(1)
        return url

    def search_anime(self, query):
        """Recherche sur VostFree."""
        search_url = "https://vostfree.ws/index.php?do=search"
        data = {
            "do": "search",
            "subaction": "search",
            "story": query
        }

        try:
            response = self.session.post(search_url, data=data, headers=self.headers, impersonate="chrome110", timeout=20)
            results = []
            if response and response.status_code == 200:
                soup = BeautifulSoup(response.text, 'html.parser')
                for a in soup.find_all('a', href=True):
                    href = a['href']
                    if (('-vf' in href.lower() or '-vostfr' in href.lower()) and '.html' in href):
                        title = a.text.strip() or href.split('/')[-1].replace('.html', '').replace('-', ' ').title()
                        if query.lower() in title.lower() or query.lower() in href.lower():
                            results.append({
                                "title": title,
                                "url": href if href.startswith('http') else "https://vostfree.ws" + href
                            })

            unique = []
            seen = set()
            for r in results:
                if r['url'] not in seen:
                    unique.append(r)
                    seen.add(r['url'])
            return unique
        except Exception as e:
            return [{"error": str(e)}]

    def get_episodes(self, anime_url):
        """Récupère les épisodes."""
        response = self._get(anime_url)
        if not response or response.status_code != 200:
            return {"error": "Failed to fetch page"}

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

        return episodes

    def get_stream_links(self, episode_url):
        """Récupère les liens de streaming."""
        base_url = episode_url.split('#')[0]
        player_id = episode_url.split('#')[1] if '#' in episode_url else None

        response = self._get(base_url)
        resolved_links = []

        if response and response.status_code == 200:
            text = response.text

            # 1. Chercher les liens directs dans le texte
            all_links = re.findall(r'https?://(?:www\.)?(?:yourupload\.com|sibnet\.ru|ok\.ru|mystream\.to|upstream\.to|embed\.|player\.|stream\.)[^\s\'\"<>]+', text)

            # 2. Chercher les IDs Sibnet cachés dans content_player_X
            # Structure: <div id="buttons_1">...<div id="player_2">...</div></div>
            # <div id="content_player_2">123456</div>
            if player_id:
                # Trouver quel player est associé au bouton
                # Ex: buttons_1 -> player_2
                # On cherche <div id="buttons_1" ... <div id="player_(\d+)"
                player_match = re.search(fr'id="{player_id}"[^>]*>.*?id="player_(\d+)"', text, re.DOTALL)
                if player_match:
                    p_id = player_match.group(1)
                    # Trouver le contenu de content_player_X
                    content_match = re.search(fr'id="content_player_{p_id}"[^>]*>(\d+)<', text)
                    if content_match:
                        sibnet_id = content_match.group(1)
                        all_links.append(f"https://video.sibnet.ru/shell.php?videoid={sibnet_id}")

            for link in all_links:
                link = link.replace('\\', '')
                if link not in resolved_links:
                    res = self.resolve_stream(link)
                    if res not in resolved_links:
                        resolved_links.append(res)

        # 3. Recherche Google de secours pour YourUpload
        try:
            ep_num = "01"
            if player_id and "buttons_" in player_id:
                try:
                    ep_num = str(int(player_id.replace("buttons_", ""))).zfill(2)
                except: pass

            anime_slug = base_url.split('/')[-1].replace('.html', '').replace('-vf', '').replace('-vostfr', '').replace('-ddl-streaming-1fichier-uptobox', '').replace('-', ' ')

            # On cherche "Soul Eater Episode 01 VF yourupload"
            query = f'{anime_slug} Episode {ep_num} VF yourupload'
            print(f"Searching Google: {query}", file=sys.stderr)

            for url in search(query, num_results=5):
                if 'yourupload.com' in url:
                    res = self.resolve_stream(url)
                    if res not in resolved_links:
                        resolved_links.append(res)

        except Exception as e:
            print(f"Google search error: {e}", file=sys.stderr)

        return list(set(resolved_links))

if __name__ == "__main__":
    scraper = UniversalAnimeScraper()
    action = sys.argv[1]
    if action == "search":
        print(json.dumps(scraper.search_anime(sys.argv[2]), indent=2))
    elif action == "episodes":
        print(json.dumps(scraper.get_episodes(sys.argv[2]), indent=2))
    elif action == "stream":
        print(json.dumps(scraper.get_stream_links(sys.argv[2]), indent=2))
