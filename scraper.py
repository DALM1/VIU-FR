from curl_cffi import requests
from bs4 import BeautifulSoup
import sys
import json
import re
from urllib.parse import urljoin, urlparse, parse_qs, unquote
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
        self._franime_catalog = None

    def _get(self, url, referer=None, impersonate="chrome110", headers=None, session=None):
        request_headers = self.headers.copy()
        if headers:
            request_headers.update(headers)
        if referer:
            request_headers["Referer"] = referer
        client = session or self.session
        try:
            response = client.get(url, headers=request_headers, impersonate=impersonate, timeout=20)
            return response
        except Exception as e:
            print(f"Error fetching {url}: {e}", file=sys.stderr)
            return None

    def _post(self, url, data=None, json_data=None, referer=None, impersonate="chrome110", headers=None, session=None):
        request_headers = self.headers.copy()
        if headers:
            request_headers.update(headers)
        if referer:
            request_headers["Referer"] = referer
        client = session or self.session
        try:
            return client.post(
                url,
                data=data,
                json=json_data,
                headers=request_headers,
                impersonate=impersonate,
                timeout=20,
            )
        except Exception as e:
            print(f"Error posting {url}: {e}", file=sys.stderr)
            return None

    def _normalize_title(self, title):
        if not title:
            return ""
        title = title.lower()
        title = re.sub(r"<[^>]+>", "", title)
        title = title.replace("&amp;", "and")
        title = re.sub(r"[^a-z0-9]+", " ", title)
        return re.sub(r"\s+", " ", title).strip()

    def _slugify_title(self, title):
        return self._normalize_title(title).replace(" ", "-")

    def _score_candidate_titles(self, titles, query):
        query_norm = self._normalize_title(query)
        if not query_norm:
            return 0

        query_tokens = set(query_norm.split())
        best_score = 0

        for title in titles:
            candidate = self._normalize_title(title)
            if not candidate:
                continue

            if candidate == query_norm:
                best_score = max(best_score, 400)
                continue

            if candidate.startswith(query_norm):
                best_score = max(best_score, 280 - max(0, len(candidate) - len(query_norm)))

            if query_norm in candidate:
                best_score = max(best_score, 240 - max(0, len(candidate) - len(query_norm)))

            candidate_tokens = set(candidate.split())
            if query_tokens and candidate_tokens:
                overlap = len(query_tokens & candidate_tokens)
                if overlap:
                    ratio = overlap / len(query_tokens)
                    token_score = int(160 * ratio)
                    if query_tokens.issubset(candidate_tokens):
                        token_score += 40
                    best_score = max(best_score, token_score)

        return best_score

    def _unique_titles(self, media):
        titles = [
            media["title"].get("english"),
            media["title"].get("romaji"),
            media["title"].get("native"),
        ]
        result = []
        seen = set()
        for title in titles:
            if title and title not in seen:
                seen.add(title)
                result.append(title)
        return result

    def _match_anilist_media(self, media_list, titles):
        best_media = None
        best_score = 0
        for media in media_list:
            score = self._score_candidate_titles(self._unique_titles(media), " ".join(titles))
            if score > best_score:
                best_score = score
                best_media = media
        return best_media if best_score >= 120 else None

    def _build_anilist_result(self, media):
        title_main = media["title"]["english"] or media["title"]["romaji"] or media["title"]["native"]
        return {
            "id": media["id"],
            "title": title_main,
            "romaji": media["title"]["romaji"],
            "poster": media["coverImage"]["large"],
            "synopsis": media["description"],
            "genres": media["genres"],
            "score": media["averageScore"],
            "status": media["status"],
            "format": media.get("format"),
            "total_episodes": media["episodes"],
            "source_label": "anglais",
            "url": f"SEARCH_ENG:{title_main}",
        }

    def _enrich_result_with_anilist(self, result, media):
        if not media:
            return result

        result["poster"] = result.get("poster") or media["coverImage"]["large"]
        result["synopsis"] = result.get("synopsis") or media["description"]
        result["genres"] = result.get("genres") or media["genres"]
        result["score"] = result.get("score") if result.get("score") is not None else media["averageScore"]
        result["status"] = result.get("status") or media["status"]
        result["format"] = result.get("format") or media.get("format")
        result["total_episodes"] = result.get("total_episodes") or media["episodes"]
        result["romaji"] = result.get("romaji") or media["title"]["romaji"] or result["title"]
        return result

    def query_anilist(self, search_query):
        """Récupère les métadonnées globales via l'API GraphQL d'AniList."""
        query = """
        query ($search: String) {
          Page(perPage: 10) {
            media(search: $search, type: ANIME) {
              id
              format
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
        """
        variables = {"search": search_query}
        url = "https://graphql.anilist.co"

        try:
            response = self.session.post(url, json={"query": query, "variables": variables}, timeout=10)
            if response.status_code == 200:
                data = response.json()
                return data["data"]["Page"]["media"]
        except Exception as e:
            print(f"AniList API error: {e}", file=sys.stderr)
        return []

    def _find_vf_source(self, title):
        """Cherche une URL VostFree pour un titre donné."""
        search_url = "https://vostfree.ws/index.php?do=search"
        data = {"do": "search", "subaction": "search", "story": title}
        try:
            response = self._post(search_url, data=data)
            if response and response.status_code == 200:
                soup = BeautifulSoup(response.text, "html.parser")
                title_norm = self._normalize_title(title)
                for a in soup.find_all("a", href=True):
                    href = a["href"]
                    if ("-vf" in href.lower() or "-vostfr" in href.lower()) and ".html" in href:
                        link_text = self._normalize_title(a.text.strip())
                        href_norm = self._normalize_title(href)
                        if title_norm and (title_norm in link_text or title_norm in href_norm):
                            return href if href.startswith("http") else "https://vostfree.ws" + href
        except Exception:
            pass
        return None

    def _search_vostfree(self, query, anilist_results=None):
        search_url = "https://vostfree.ws/index.php?do=search"
        data = {"do": "search", "subaction": "search", "story": query}
        results = []
        seen_urls = set()

        response = self._post(search_url, data=data)
        if not response or response.status_code != 200:
            return results

        soup = BeautifulSoup(response.text, "html.parser")
        for anchor in soup.find_all("a", href=True):
            href = anchor["href"]
            if ".html" not in href or ("-vf" not in href.lower() and "-vostfr" not in href.lower()):
                continue

            title = anchor.get_text(" ", strip=True)
            score = self._score_candidate_titles([title, href], query)
            if score < 70:
                continue

            url = href if href.startswith("http") else urljoin("https://vostfree.ws", href)
            if url in seen_urls:
                continue
            seen_urls.add(url)

            result = {
                "id": f"VOSTFREE_{len(results) + 1}",
                "title": title or href,
                "romaji": title or href,
                "poster": None,
                "synopsis": "",
                "genres": [],
                "score": None,
                "status": "AVAILABLE",
                "format": None,
                "total_episodes": None,
                "source_label": "vostfree",
                "url": url,
                "_relevance": score + 15,
            }

            if anilist_results:
                media = self._match_anilist_media(anilist_results, [title])
                result = self._enrich_result_with_anilist(result, media)

            results.append(result)

        results.sort(key=lambda item: item.get("_relevance", 0), reverse=True)
        return results[:10]

    def _get_franime_catalog(self):
        if self._franime_catalog is not None:
            return self._franime_catalog

        response = self._get("https://api.franime.fr/api/animes/")
        if response and response.status_code == 200:
            try:
                self._franime_catalog = response.json()
                return self._franime_catalog
            except Exception:
                pass

        self._franime_catalog = []
        return self._franime_catalog

    def _search_franime_catalog(self, query):
        query_norm = self._normalize_title(query)
        results = []
        for entry in self._get_franime_catalog():
            titles = [
                entry.get("title"),
                entry.get("titleO"),
                (entry.get("titles") or {}).get("en"),
                (entry.get("titles") or {}).get("en_jp"),
                (entry.get("titles") or {}).get("en_us"),
                (entry.get("titles") or {}).get("ja_jp"),
            ]
            normalized = [self._normalize_title(title) for title in titles if title]
            if any(query_norm in title for title in normalized):
                results.append(entry)
        return results

    def _score_franime_entry(self, entry, query):
        query_norm = self._normalize_title(query)
        titles = [
            entry.get("title"),
            entry.get("titleO"),
            (entry.get("titles") or {}).get("en"),
            (entry.get("titles") or {}).get("en_jp"),
            (entry.get("titles") or {}).get("en_us"),
            (entry.get("titles") or {}).get("ja_jp"),
        ]
        normalized = [self._normalize_title(title) for title in titles if title]
        best_score = 0
        for title in normalized:
            if title == query_norm:
                best_score = max(best_score, 300)
            elif query_norm in title:
                best_score = max(best_score, 200 - max(0, len(title) - len(query_norm)))
            elif title in query_norm:
                best_score = max(best_score, 120 - max(0, len(query_norm) - len(title)))
        return best_score

    def _count_franime_episodes(self, entry):
        total = 0
        for season in entry.get("saisons") or []:
            total += len(season.get("episodes") or [])
        return total or None

    def _build_franime_result(self, entry):
        display_title = entry.get("title") or entry.get("titleO") or (entry.get("titles") or {}).get("en_jp") or "Anime"
        status = entry.get("status") or "AVAILABLE"
        score = None
        try:
            if entry.get("note") not in (None, ""):
                score = int(round(float(entry["note"]) * 10))
        except Exception:
            score = None

        return {
            "id": f"FRANIME_{entry['id']}",
            "title": display_title,
            "romaji": (entry.get("titles") or {}).get("en_jp") or entry.get("titleO") or display_title,
            "poster": entry.get("affiche") or entry.get("affiche_small") or entry.get("banner"),
            "synopsis": entry.get("description") or "",
            "genres": entry.get("themes") or [],
            "score": score,
            "status": status,
            "format": entry.get("format"),
            "total_episodes": self._count_franime_episodes(entry),
            "source_label": "franime",
            "url": self._build_franime_url(entry),
        }

    def _search_franime(self, query, anilist_results=None):
        results = []
        for entry in self._search_franime_catalog(query):
            scored = self._score_candidate_titles(
                [
                    entry.get("title"),
                    entry.get("titleO"),
                    (entry.get("titles") or {}).get("en"),
                    (entry.get("titles") or {}).get("en_jp"),
                    (entry.get("titles") or {}).get("en_us"),
                    (entry.get("titles") or {}).get("ja_jp"),
                ],
                query,
            )
            if scored <= 0:
                continue
            result = self._build_franime_result(entry)
            result["_relevance"] = scored + 10
            if anilist_results:
                media = self._match_anilist_media(anilist_results, [result["title"], result["romaji"]])
                result = self._enrich_result_with_anilist(result, media)
            results.append((scored, result))

        results.sort(key=lambda item: item[0], reverse=True)
        return [result for _, result in results[:12]]

    def _match_franime_entry(self, candidates, titles):
        normalized_titles = [self._normalize_title(title) for title in titles if title]
        best_entry = None
        best_score = -1

        for entry in candidates:
            entry_titles = [
                entry.get("title"),
                entry.get("titleO"),
                (entry.get("titles") or {}).get("en"),
                (entry.get("titles") or {}).get("en_jp"),
                (entry.get("titles") or {}).get("en_us"),
                (entry.get("titles") or {}).get("ja_jp"),
            ]
            entry_norm = [self._normalize_title(title) for title in entry_titles if title]
            score = 0
            for title in normalized_titles:
                if title in entry_norm:
                    score += 100
                elif any(title and (title in candidate or candidate in title) for candidate in entry_norm):
                    score += 50
            if score > best_score:
                best_score = score
                best_entry = entry

        return best_entry if best_score > 0 else None

    def _build_franime_url(self, entry, lang="vo"):
        slug = self._slugify_title(entry.get("title") or entry.get("titleO"))
        return f"https://franime.fr/anime/{slug}?s=1&ep=&lang={lang}&anime_id={entry['id']}"

    def _find_atitop_source(self, titles):
        for title in titles:
            try:
                query = f'site:atitop.com/j10np175/b/atitop "{title}"'
                for url in search(query, num_results=3):
                    if "atitop.com/j10np175/b/atitop/" in url:
                        return url
            except Exception:
                continue
        return None

    def _extract_atitop_metadata(self, url):
        response = self._get(url)
        if not response or response.status_code != 200:
            return None

        soup = BeautifulSoup(response.text, "html.parser")
        title = None
        description = ""
        poster = None

        if soup.title and soup.title.text:
            title = soup.title.text.replace("Atitop -", "").strip()

        og_title = soup.find("meta", attrs={"property": "og:title"})
        if og_title and og_title.get("content"):
            title = og_title["content"].strip()

        og_description = soup.find("meta", attrs={"property": "og:description"})
        if og_description and og_description.get("content"):
            description = og_description["content"].strip()

        if not description:
            paragraph = soup.find("p")
            if paragraph:
                description = paragraph.get_text(" ", strip=True)

        og_image = soup.find("meta", attrs={"property": "og:image"})
        if og_image and og_image.get("content"):
            poster = og_image["content"].strip()

        if not poster:
            image = soup.find("img", src=True)
            if image:
                poster = urljoin(url, image["src"])

        return {
            "title": title or "Film",
            "synopsis": description,
            "poster": poster,
        }

    def _get_atitop_films_page(self, offset=0, limit=20):
        url = f"https://www.atitop.com/j10np175/api_films.php?offset={offset}&limit={limit}&folder=j10np175&pr=atitop"
        response = self._get(url, referer="https://www.atitop.com/j10np175")
        if response and response.status_code == 200:
            try:
                return response.json().get("films", [])
            except Exception:
                return []
        return []

    def _search_atitop(self, query, anilist_results=None):
        results = []
        seen_urls = set()

        for offset in range(0, 1200, 20):
            films = self._get_atitop_films_page(offset=offset, limit=20)
            if not films:
                break

            for film in films:
                title = film.get("title") or ""
                score = self._score_candidate_titles([title], query)
                if score < 70:
                    continue

                url = urljoin("https://www.atitop.com", film.get("link", ""))
                if not url or url in seen_urls:
                    continue
                seen_urls.add(url)

                metadata = self._extract_atitop_metadata(url) or {}
                display_title = re.sub(r"\s*\(\d{4}\)$", "", title).strip() or metadata.get("title") or "Film"
                category = film.get("cat") or "Film"
                poster = metadata.get("poster") or film.get("poster")

                match = re.search(r"/b/atitop/(\d+)", url)
                result_id = f"ATITOP_{match.group(1)}" if match else f"ATITOP_{len(results) + 1}"

                results.append(
                    {
                        "id": result_id,
                        "title": display_title,
                        "romaji": display_title,
                        "poster": poster,
                        "synopsis": metadata.get("synopsis") or "",
                        "genres": [category],
                        "score": None,
                        "status": "AVAILABLE",
                        "format": "MOVIE",
                        "total_episodes": 1,
                        "source_label": "atitop",
                        "url": url,
                        "_relevance": score + 20,
                    }
                )

                if anilist_results:
                    media = self._match_anilist_media(anilist_results, [display_title])
                    results[-1] = self._enrich_result_with_anilist(results[-1], media)

            if len(results) >= 12:
                break

        results.sort(key=lambda item: item.get("_relevance", 0), reverse=True)
        return results

    def search_anime(self, query):
        """Recherche agrégée sur AniList, VostFree, FRAnime et Atitop."""
        anilist_results = self.query_anilist(query)
        final_results = []

        for media in anilist_results:
            result = self._build_anilist_result(media)
            result["_relevance"] = self._score_candidate_titles(self._unique_titles(media), query)
            final_results.append(result)

        existing_urls = {result["url"] for result in final_results}

        for vostfree_result in self._search_vostfree(query, anilist_results):
            if vostfree_result["url"] not in existing_urls:
                final_results.append(vostfree_result)
                existing_urls.add(vostfree_result["url"])

        for franime_result in self._search_franime(query, anilist_results):
            if franime_result["url"] not in existing_urls:
                final_results.append(franime_result)
                existing_urls.add(franime_result["url"])

        for atitop_result in self._search_atitop(query, anilist_results):
            if atitop_result["url"] not in existing_urls:
                final_results.append(atitop_result)
                existing_urls.add(atitop_result["url"])

        final_results.sort(key=lambda item: item.get("_relevance", 0), reverse=True)
        for result in final_results:
            result.pop("_relevance", None)

        return final_results[:30]

    def _find_franime_entry_from_url(self, anime_url):
        parsed = urlparse(anime_url)
        query = parse_qs(parsed.query)
        anime_id = query.get("anime_id", [None])[0]
        slug = parsed.path.rstrip("/").split("/")[-1] if parsed.path else ""
        slug_norm = self._normalize_title(unquote(slug).replace("-", " "))

        for entry in self._get_franime_catalog():
            if anime_id and str(entry.get("id")) == str(anime_id):
                return entry

        for entry in self._get_franime_catalog():
            titles = [
                entry.get("title"),
                entry.get("titleO"),
                (entry.get("titles") or {}).get("en"),
                (entry.get("titles") or {}).get("en_jp"),
            ]
            normalized = [self._normalize_title(title) for title in titles if title]
            if slug_norm and any(slug_norm == title or slug_norm in title for title in normalized):
                return entry
        return None

    def _franime_episode_page_url(self, entry, season_index, episode_index, lang):
        slug = self._slugify_title(entry.get("title") or entry.get("titleO"))
        return (
            f"https://franime.fr/anime/{slug}"
            f"?s={season_index + 1}&ep={episode_index + 1}&lang={lang}&anime_id={entry['id']}"
        )

    def _get_franime_info(self, anime_url):
        entry = self._find_franime_entry_from_url(anime_url)
        if not entry:
            return {"episodes": []}

        episodes = []
        for season_index, season in enumerate(entry.get("saisons") or []):
            season_title = season.get("title") or f"Saison {season_index + 1}"
            for episode_index, episode in enumerate(season.get("episodes") or []):
                episode_title = episode.get("title") or f"Épisode {episode_index + 1}"
                for lang_code, label in (("vf", "VF"), ("vo", "VOSTFR")):
                    lecteurs = ((episode.get("lang") or {}).get(lang_code) or {}).get("lecteurs") or []
                    if not lecteurs:
                        continue
                    value = f"FRANIME:{entry['id']}:{season_index}:{episode_index}:{lang_code}"
                    prefix = f"{season_title} - " if len(entry.get("saisons") or []) > 1 else ""
                    episodes.append({"title": f"{prefix}{episode_title} [{label}]", "url": value})

        return {"title": entry.get("title") or entry.get("titleO"), "episodes": episodes}

    def _get_atitop_info(self, anime_url):
        response = self._get(anime_url)
        if not response or response.status_code != 200:
            return {"episodes": []}

        soup = BeautifulSoup(response.text, "html.parser")
        title = None
        if soup.title:
            title = soup.title.text.replace("Atitop -", "").strip()
        if not title:
            title = "Film"

        return {
            "title": title,
            "episodes": [{"title": "Film", "url": f"ATITOP:{anime_url}"}],
        }

    def get_anime_info(self, anime_url):
        """Récupère les épisodes."""
        if anime_url.startswith("SEARCH_ENG:"):
            title = anime_url.replace("SEARCH_ENG:", "")
            return {
                "title": title,
                "episodes": [{"title": f"Episode {i + 1} (ENG SUB/DUB)", "url": f"SEARCH_STREAM_ENG:{title} episode {i + 1}"} for i in range(12)],
            }

        if "franime.fr" in anime_url:
            return self._get_franime_info(anime_url)

        if "atitop.com" in anime_url:
            return self._get_atitop_info(anime_url)

        response = self._get(anime_url)
        if not response or response.status_code != 200:
            return {"episodes": []}

        soup = BeautifulSoup(response.text, "html.parser")
        episodes = []

        select = soup.find("select", class_="new_player_selector")
        if select:
            for opt in select.find_all("option"):
                episodes.append({"title": opt.text.strip(), "url": anime_url + "#" + opt["value"]})

        if not episodes:
            for btn in soup.find_all(["div", "a", "span"], class_=re.compile(r"button|episode|play")):
                text = btn.text.strip()
                if text.isdigit() or "episode" in text.lower():
                    url = btn.get("href") or btn.get("data-url")
                    if url:
                        episodes.append(
                            {
                                "title": f"Épisode {text}",
                                "url": url if url.startswith("http") else "https://vostfree.ws" + url,
                            }
                        )
        return {"episodes": episodes}

    def _get_franime_stream_links(self, token):
        try:
            _, anime_id, season_index, episode_index, lang = token.split(":")
            anime_id = int(anime_id)
            season_index = int(season_index)
            episode_index = int(episode_index)
        except ValueError:
            return []

        entry = None
        for candidate in self._get_franime_catalog():
            if int(candidate.get("id", -1)) == anime_id:
                entry = candidate
                break
        if not entry:
            return []

        seasons = entry.get("saisons") or []
        if season_index >= len(seasons):
            return []
        episodes = seasons[season_index].get("episodes") or []
        if episode_index >= len(episodes):
            return []

        lecteurs = (((episodes[episode_index].get("lang") or {}).get(lang) or {}).get("lecteurs")) or []
        if not lecteurs:
            return []

        page_url = self._franime_episode_page_url(entry, season_index, episode_index, lang)
        api_url_template = f"https://api.franime.fr/api/anime/{anime_id}/{season_index}/{episode_index}/{lang}"

        local_session = requests.Session()
        landing = self._get(page_url, session=local_session)
        if not landing or landing.status_code != 200:
            return []

        links = []
        for lecteur_index, lecteur_name in enumerate(lecteurs):
            if "TELECHARGEMENT" in lecteur_name.upper():
                continue

            response = self._get(
                f"{api_url_template}/{lecteur_index}",
                session=local_session,
                headers={"Origin": "https://franime.fr"},
                referer=page_url,
            )
            if not response or response.status_code != 200:
                continue

            url = response.text.strip()
            if url.startswith("http") and url not in links:
                links.append(url)

        return links

    def _get_atitop_stream_links(self, token):
        page_url = token.replace("ATITOP:", "", 1)
        response = self._get(page_url)
        if not response or response.status_code != 200:
            return []

        soup = BeautifulSoup(response.text, "html.parser")
        iframe_urls = []
        for iframe in soup.find_all("iframe", src=True):
            iframe_urls.append(urljoin(page_url, iframe["src"]))

        resolved = []
        for url in iframe_urls:
            stream = self.resolve_stream(url)
            if stream and stream not in resolved:
                resolved.append(stream)
        return resolved

    def get_stream_links(self, episode_url):
        """Récupère les liens de streaming."""
        if episode_url.startswith("SEARCH_STREAM_ENG:"):
            query = episode_url.replace("SEARCH_STREAM_ENG:", "")
            links = []
            try:
                for url in search(f'"{query}" stream yourupload', num_results=3):
                    if "yourupload.com" in url:
                        res = self.resolve_stream(url)
                        if res:
                            links.append(res)
            except Exception:
                pass
            return links

        if episode_url.startswith("FRANIME:"):
            return self._get_franime_stream_links(episode_url)

        if episode_url.startswith("ATITOP:"):
            return self._get_atitop_stream_links(episode_url)

        base_url = episode_url.split("#")[0]
        player_id = episode_url.split("#")[1] if "#" in episode_url else None

        response = self._get(base_url)
        resolved_links = []
        if response and response.status_code == 200:
            text = response.text
            all_links = re.findall(
                r'https?://(?:www\.)?(?:yourupload\.com|sibnet\.ru|ok\.ru|mystream\.to|upstream\.to|embed\.|player\.|stream\.)[^\s\'\"<>]+',
                text,
            )
            if player_id:
                player_match = re.search(fr'id="{player_id}"[^>]*>.*?id="player_(\d+)"', text, re.DOTALL)
                if player_match:
                    p_id = player_match.group(1)
                    content_match = re.search(fr'id="content_player_{p_id}"[^>]*>(\d+)<', text)
                    if content_match:
                        sibnet_id = content_match.group(1)
                        all_links.append(f"https://video.sibnet.ru/shell.php?videoid={sibnet_id}")

            for link in all_links:
                link = link.replace("\\", "")
                res = self.resolve_stream(link)
                if res and res not in resolved_links:
                    resolved_links.append(res)

        return list(dict.fromkeys(resolved_links))

    def resolve_stream(self, url):
        """Résout quelques hébergeurs en URL plus directe quand c'est possible."""
        if not url:
            return None

        if url.startswith("//"):
            url = "https:" + url

        if "yourupload.com" in url:
            embed_url = url.replace("/watch/", "/embed/")
            res = self._get(embed_url)
            if res and res.status_code == 200:
                match = re.search(r'og:video"\s+content="([^"]+)"', res.text)
                if match:
                    return match.group(1)

        if "sharecloudy.com" in url:
            res = self._get(url)
            if res and res.status_code == 200:
                match = re.search(r'file:\s*"([^"]+)"', res.text)
                if not match:
                    match = re.search(r'https?://[^\s\'"<>]+m3u8[^\s\'"<>]*', res.text)
                if match:
                    return match.group(1) if hasattr(match, "group") else match[0]

        return url

    def download_video(self, url, output_path):
        """Utilise yt-dlp pour télécharger la vidéo."""
        try:
            subprocess.run(["yt-dlp", "-o", output_path, url], check=True)
            return True
        except Exception:
            return False

    def get_poster_art(self, url, width=40, height=20):
        """Télécharge le poster et le convertit en ASCII via chafa."""
        try:
            response = self._get(url)
            if response and response.status_code == 200:
                with tempfile.NamedTemporaryFile(delete=False, suffix=".jpg") as tmp:
                    tmp.write(response.content)
                    tmp_path = tmp.name

                try:
                    cmd = ["chafa", f"--size={width}x{height}", "--symbols=block", "--color-space=256", "--dither=none", tmp_path]
                    result = subprocess.run(cmd, capture_output=True, text=True)
                    os.unlink(tmp_path)
                    return result.stdout
                except Exception as e:
                    if os.path.exists(tmp_path):
                        os.unlink(tmp_path)
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
        w = int(sys.argv[3]) if len(sys.argv) > 3 else 40
        h = int(sys.argv[4]) if len(sys.argv) > 4 else 20
        print(scraper.get_poster_art(sys.argv[2], w, h))
