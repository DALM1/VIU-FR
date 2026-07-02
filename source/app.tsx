import { useState, useEffect, useMemo, useRef } from 'react';
import { Box, Text, useInput, useApp, useStdout } from 'ink';
import TextInput from 'ink-text-input';
import SelectInput from 'ink-select-input';
import { execa } from 'execa';
import { readFileSync } from 'fs';
import path from 'path';
import os from 'os';

const ASCII_ART = `
____   ____.___ ____ ___  _____________________
\\   \\ /   /|   |    |   \\ \\_   _____/\\______   \\
 \\   Y   / |   |    |   /  |    __)   |       _/
  \\     /  |   |    |  /   |     \\    |    |   \\
   \\___/   |___|______/    \\___  /    |____|_  /
                               \\/            \\/
`;

const COMPACT_ASCII_ART = `VIU FR`;

const cleanText = (value?: string) =>
	value?.replace(/<[^>]*>?/gm, '').replace(/\s+/g, ' ').trim() || '';

const isBrowserStreamTarget = (value: string) => value.startsWith('FRANIME_BROWSER:');

const getStreamDisplayLabel = (value: string, index: number, isTiny: boolean) => {
	if (isBrowserStreamTarget(value)) {
		return `Navigateur ${index + 1}`;
	}

	if (value.includes('franime.fr/anime')) {
		return `Franime (yt-dlp)`;
	}

	if (value.includes('watch2')) {
		return `Franime (watch2)`;
	}

	return value.split('/').pop()?.slice(0, isTiny ? 24 : 36) || `Lecteur ${index + 1}`;
};

const buildMpvArgs = (url: string) => ['--fs', url];

const openExternalUrl = async (url: string) => {
	const command = process.platform === 'darwin' ? 'open' : 'xdg-open';
	await execa(command, [url], {stdio: 'ignore'});
};

// #region debug-point A:franime-ui-debug-helper
const debugEvent = async (
	hypothesisId: string,
	location: string,
	msg: string,
	data: Record<string, unknown> = {},
	runId = 'pre-fix',
) => {
	let debugServerUrl = 'http://127.0.0.1:7778/event';
	let sessionId = 'franime-mpv-episode-list';

	try {
		const env = readFileSync(path.join(process.cwd(), '.dbg', 'franime-mpv-episode-list.env'), 'utf8');
		for (const line of env.split(/\r?\n/)) {
			if (line.startsWith('DEBUG_SERVER_URL=')) {
				debugServerUrl = line.slice('DEBUG_SERVER_URL='.length);
			} else if (line.startsWith('DEBUG_SESSION_ID=')) {
				sessionId = line.slice('DEBUG_SESSION_ID='.length);
			}
		}
	} catch {}

	try {
		await fetch(debugServerUrl, {
			method: 'POST',
			headers: {'Content-Type': 'application/json'},
			body: JSON.stringify({
				sessionId,
				runId,
				hypothesisId,
				location,
				msg: `[DEBUG] ${msg}`,
				data,
			}),
		});
	} catch {}
};
// #endregion

const getEpisodeLanguageTag = (label: string) => {
	const match = label.match(/\[(VF|VOSTFR)\]/i);
	return match?.[1]?.toUpperCase() ?? null;
};

const findNextEpisodeIndex = (items: ListItem[], currentIndex: number) => {
	if (currentIndex < 0 || currentIndex >= items.length - 1) {
		return currentIndex;
	}

	const currentLanguage = getEpisodeLanguageTag(items[currentIndex]?.label ?? '');
	if (!currentLanguage) {
		return Math.min(items.length - 1, currentIndex + 1);
	}

	for (let index = currentIndex + 1; index < items.length; index += 1) {
		if (getEpisodeLanguageTag(items[index]?.label ?? '') === currentLanguage) {
			return index;
		}
	}

	return currentIndex;
};

const clampTextLines = (value: string, maxWidth: number, maxLines: number) => {
	if (!value) {
		return '';
	}

	const safeWidth = Math.max(8, maxWidth);
	const safeLines = Math.max(1, maxLines);
	const words = value.split(/\s+/).filter(Boolean);
	const lines: string[] = [];
	let currentLine = '';

	for (const word of words) {
		const truncatedWord = word.length > safeWidth ? `${word.slice(0, Math.max(1, safeWidth - 1))}…` : word;
		const nextLine = currentLine ? `${currentLine} ${truncatedWord}` : truncatedWord;
		if (nextLine.length <= safeWidth) {
			currentLine = nextLine;
			continue;
		}

		if (currentLine) {
			lines.push(currentLine);
		}

		currentLine = truncatedWord;
		if (lines.length === safeLines) {
			break;
		}
	}

	if (lines.length < safeLines && currentLine) {
		lines.push(currentLine);
	}

	if (lines.length === 0) {
		return '';
	}

	const hasOverflow = words.join(' ').length > lines.join(' ').length;
	if (hasOverflow) {
		const lastLine = lines[Math.min(lines.length, safeLines) - 1] ?? '';
		lines[Math.min(lines.length, safeLines) - 1] =
			lastLine.length >= safeWidth ? `${lastLine.slice(0, Math.max(1, safeWidth - 1))}…` : `${lastLine}…`;
	}

	return lines.slice(0, safeLines).join('\n');
};

const mergeSearchResults = (currentResults: any[], incomingResults: any[]) => {
	const mergedByUrl = new Map<string, any>();

	for (const result of currentResults) {
		mergedByUrl.set(result.url, {...result});
	}

	for (const result of incomingResults) {
		if (!result?.url) {
			continue;
		}

		const existing = mergedByUrl.get(result.url);
		if (!existing) {
			mergedByUrl.set(result.url, {...result});
			continue;
		}

		const merged = {...existing};
		for (const [key, value] of Object.entries(result)) {
			if (key === '_relevance') {
				merged[key] = Math.max(existing[key] ?? 0, (value as number | undefined) ?? 0);
			} else if (
				value !== undefined &&
				value !== null &&
				value !== '' &&
				(!Array.isArray(value) || value.length > 0)
			) {
				merged[key] = value;
			}
		}

		mergedByUrl.set(result.url, merged);
	}

	return [...mergedByUrl.values()]
		.sort((left, right) => (right._relevance ?? 0) - (left._relevance ?? 0))
		.slice(0, 30);
};

type ListItem = {
	label: string;
	value: string;
};

type ScrollableListProps = {
	items: ListItem[];
	selectedIndex: number;
	height: number;
	emptyLabel: string;
};

const ScrollableList = ({items, selectedIndex, height, emptyLabel}: ScrollableListProps) => {
	if (items.length === 0) {
		return <Text dimColor>{emptyLabel}</Text>;
	}

	const safeSelectedIndex = Math.max(0, Math.min(selectedIndex, items.length - 1));
	const visibleCount = Math.max(1, height);
	const maxStartIndex = Math.max(0, items.length - visibleCount);
	const startIndex = Math.min(Math.max(0, safeSelectedIndex - visibleCount + 1), maxStartIndex);
	const visibleItems = items.slice(startIndex, startIndex + visibleCount);

	// #region debug-point D:episodes-viewport
	void debugEvent('D', 'source/app.tsx:ScrollableList', 'Computed scrollable list viewport', {
		itemsLength: items.length,
		selectedIndex,
		safeSelectedIndex,
		height,
		visibleCount,
		startIndex,
		firstVisibleLabel: visibleItems[0]?.label ?? null,
		lastVisibleLabel: visibleItems[visibleItems.length - 1]?.label ?? null,
	});
	// #endregion

	return (
		<Box flexDirection="column" flexGrow={1} overflow="hidden">
			{visibleItems.map((item, index) => {
				const itemIndex = startIndex + index;
				const isSelected = itemIndex === safeSelectedIndex;

				return (
					<Text key={`${item.value}-${itemIndex}`} color={isSelected ? 'yellow' : undefined} wrap="truncate-end">
						{isSelected ? '› ' : '  '}
						{item.label}
					</Text>
				);
			})}
		</Box>
	);
};

const App = () => {
	const { exit } = useApp();
	const {stdout} = useStdout();
	const [dimensions, setDimensions] = useState({
		width: stdout?.columns ?? 120,
		height: stdout?.rows ?? 40,
	});
	const [view, setView] = useState('search');
	const [query, setQuery] = useState('');
	const [results, setResults] = useState<any[]>([]);
	const [selectedAnime, setSelectedAnime] = useState<any>(null);
	const [animeInfo, setAnimeInfo] = useState<any>(null);
	const [episodes, setEpisodes] = useState<any[]>([]);
	const [streams, setStreams] = useState<any[]>([]);
	const [selectedEpisodeIndex, setSelectedEpisodeIndex] = useState(0);
	const [selectedStreamIndex, setSelectedStreamIndex] = useState(0);
	const [activeEpisodeIndex, setActiveEpisodeIndex] = useState<number | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [downloading, setDownloading] = useState(false);
	const [posterArt, setPosterArt] = useState<string | null>(null);
	const activeSearchProcess = useRef<any>(null);
	const activeSearchId = useRef(0);

	useEffect(() => {
		const updateDimensions = () => {
			setDimensions({
				width: stdout?.columns ?? 120,
				height: stdout?.rows ?? 40,
			});
		};

		updateDimensions();
		stdout?.on('resize', updateDimensions);
		return () => {
			stdout?.off('resize', updateDimensions);
		};
	}, [stdout]);

	const terminalWidth = Math.max(48, dimensions.width || 0);
	const terminalHeight = Math.max(18, dimensions.height || 0);
	const isTiny = terminalWidth < 80;
	const isCompact = terminalWidth < 110;
	const showPoster = !isTiny && terminalHeight >= 22;
	const outerWidth = Math.max(46, terminalWidth - 2);
	const mainHeight = Math.max(10, terminalHeight - (error ? 8 : 7));
	const inputWidth = Math.max(24, Math.min(50, outerWidth - 10));
	const posterWidth = Math.max(16, Math.min(isCompact ? 22 : 30, Math.floor(outerWidth * (isCompact ? 0.24 : 0.28))));
	const posterHeight = Math.max(8, Math.min(14, mainHeight - 8));
	const infoPaneHeight = isTiny ? Math.max(8, Math.floor(mainHeight / 2)) : mainHeight;
	const episodeListHeight = Math.max(4, infoPaneHeight - 5);
	const streamsListHeight = Math.max(4, mainHeight - 6);
	const detailTextWidth = Math.max(18, Math.floor((isTiny ? outerWidth : outerWidth * (isCompact ? 0.5 : 0.58)) - (isTiny ? 6 : 10)));
	const synopsisMaxLines = Math.max(3, isTiny ? 4 : isCompact ? 7 : 10);

	const synopsisPreview = useMemo(() => {
		if (!selectedAnime) {
			return '';
		}

		return clampTextLines(cleanText(selectedAnime.synopsis), detailTextWidth, synopsisMaxLines);
	}, [selectedAnime, detailTextWidth, synopsisMaxLines]);

	const runScraper = async (args: string[]) => {
		setLoading(true);
		setError(null);
		try {
			const pythonPath = path.join(process.cwd(), 'venv', 'bin', 'python3');
			const {stdout} = await execa(pythonPath, ['scraper.py', ...args]);
			// #region debug-point A:run-scraper-success
			void debugEvent('A', 'source/app.tsx:runScraper', 'Scraper command completed', {
				args,
				stdoutPreview: stdout.slice(0, 280),
			});
			// #endregion
			try {
				return JSON.parse(stdout);
			} catch {
				return stdout;
			}
		} catch (err: any) {
			// #region debug-point A:run-scraper-error
			void debugEvent('A', 'source/app.tsx:runScraper', 'Scraper command failed', {
				args,
				message: err?.message ?? null,
				shortMessage: err?.shortMessage ?? null,
			});
			// #endregion
			setError(err.message);
			return null;
		} finally {
			setLoading(false);
		}
	};

	const fetchPosterArt = async (url: string, width: number, height: number) => {
		if (!url || !showPoster) {
			setPosterArt(null);
			return;
		}

		const art = await runScraper(['poster', url, String(width), String(height)]);
		setPosterArt(typeof art === 'string' ? art : null);
	};

	const advanceToNextEpisode = (episodeIndex?: number | null) => {
		if (episodeIndex === null || episodeIndex === undefined || episodes.length === 0) {
			return;
		}

		const nextIndex = findNextEpisodeIndex(episodes, episodeIndex);
		if (nextIndex !== episodeIndex) {
			setSelectedEpisodeIndex(nextIndex);
		}
	};

	const setEpisodeStreamsState = (episodeIndex: number, streamUrls: string[]) => {
		setActiveEpisodeIndex(episodeIndex);
		setSelectedEpisodeIndex(episodeIndex);
		setStreams(
			streamUrls.map((url: string, index: number) => ({
				label: getStreamDisplayLabel(url, index, isTiny),
				value: url,
			})),
		);
		setSelectedStreamIndex(0);
		setView('streams');
	};

	const resolveEpisodeStreams = async (episodeIndex: number, hypothesisId: string, location: string) => {
		const episode = episodes[episodeIndex];
		if (!episode) {
			return null;
		}

		const data = await runScraper(['stream', episode.value]);
		void debugEvent(hypothesisId, location, 'Resolved episode streams for playback sequence', {
			episodeIndex,
			episodeLabel: episode.label,
			streamCount: Array.isArray(data) ? data.length : null,
			streamsPreview: Array.isArray(data) ? data.slice(0, 5) : data,
		});

		return Array.isArray(data) && data.length > 0 ? data : null;
	};

	const playEpisodeSequence = async (
		startEpisodeIndex: number,
		initialStreams?: string[] | null,
		location = 'source/app.tsx:playEpisodeSequence',
	) => {
		let currentEpisodeIndex = startEpisodeIndex;
		let currentStreams = initialStreams ?? null;

		while (currentEpisodeIndex >= 0 && currentEpisodeIndex < episodes.length) {
			if (!currentStreams || currentStreams.length === 0) {
				currentStreams = await resolveEpisodeStreams(currentEpisodeIndex, 'C', location);
				if (!currentStreams || currentStreams.length === 0) {
					setError('Aucun lien de streaming trouvé pour l\'épisode suivant.');
					return;
				}
			}

			setEpisodeStreamsState(currentEpisodeIndex, currentStreams);

			const streamUrl = currentStreams[0];
			void debugEvent('C', location, 'Attempting sequential playback launch', {
				episodeIndex: currentEpisodeIndex,
				episodeLabel: episodes[currentEpisodeIndex]?.label ?? null,
				stream: streamUrl,
				isBrowserTarget: isBrowserStreamTarget(streamUrl),
			});

			if (isBrowserStreamTarget(streamUrl)) {
				await openExternalUrl(streamUrl.replace('FRANIME_BROWSER:', ''));
				return;
			}

			await execa('mpv', buildMpvArgs(streamUrl), {stdio: 'inherit'});

			const nextEpisodeIndex = findNextEpisodeIndex(episodes, currentEpisodeIndex);
			if (nextEpisodeIndex === currentEpisodeIndex) {
				return;
			}

			advanceToNextEpisode(currentEpisodeIndex);
			currentEpisodeIndex = nextEpisodeIndex;
			currentStreams = null;
		}
	};

	useEffect(() => {
		if (!selectedAnime?.poster || !showPoster) {
			setPosterArt(null);
			return;
		}

		void fetchPosterArt(selectedAnime.poster, posterWidth, posterHeight);
	}, [selectedAnime?.poster, showPoster, posterWidth, posterHeight]);

	useEffect(() => {
		if (results.length === 0) {
			return;
		}

		if (!selectedAnime) {
			setSelectedAnime(results[0]);
			return;
		}

		const updatedAnime = results.find(result => result.url === selectedAnime.url || result.id === selectedAnime.id);
		if (updatedAnime && updatedAnime !== selectedAnime) {
			setSelectedAnime(updatedAnime);
		}
	}, [results, selectedAnime]);

	useEffect(() => () => {
		activeSearchProcess.current?.kill();
	}, []);

	const handleSearch = async () => {
		if (!query.trim()) {
			return;
		}

		const searchQuery = query.trim();
		activeSearchId.current += 1;
		const searchId = activeSearchId.current;
		activeSearchProcess.current?.kill();

		setResults([]);
		setSelectedAnime(null);
		setView('results');
		setLoading(true);
		setError(null);

		const pythonPath = path.join(process.cwd(), 'venv', 'bin', 'python3');
		const child = execa(pythonPath, ['scraper.py', 'search-stream', searchQuery]);
		activeSearchProcess.current = child;

		let outputBuffer = '';
		const processSearchEvent = (line: string) => {
			if (!line.trim() || searchId !== activeSearchId.current) {
				return;
			}

			try {
				const event = JSON.parse(line);
				if (event?.type === 'results' && Array.isArray(event.results)) {
					setResults(currentResults => mergeSearchResults(currentResults, event.results));
				}
			} catch {
				// Ignore malformed partial lines while buffering the incremental stream.
			}
		};

		child.stdout?.on('data', chunk => {
			outputBuffer += chunk.toString();
			const lines = outputBuffer.split(/\r?\n/);
			outputBuffer = lines.pop() ?? '';
			for (const line of lines) {
				processSearchEvent(line);
			}
		});

		try {
			await child;
			processSearchEvent(outputBuffer);
		} catch (err: any) {
			if (searchId !== activeSearchId.current || err?.isCanceled || err?.signal === 'SIGTERM') {
				return;
			}

			setError(err.shortMessage || err.message || 'Erreur pendant la recherche.');
		} finally {
			if (searchId === activeSearchId.current) {
				activeSearchProcess.current = null;
				setLoading(false);
			}
		}
	};

	const handleSelectAnime = async (item: any) => {
		const anime = results.find(result => result.id.toString() === item.value);
		if (!anime) {
			return;
		}

		setSelectedAnime(anime);
		const data = await runScraper(['info', anime.url]);
		if (data) {
			setAnimeInfo(data);
			setEpisodes((data.episodes ?? []).map((episode: any) => ({label: episode.title, value: episode.url})));
			setSelectedEpisodeIndex(0);
			setView('info');
		}
	};

	const handleSelectEpisode = async (item: any) => {
		const currentEpisodeIndex = episodes.findIndex(episode => episode.value === item.value);
		// #region debug-point B:episode-selected
		void debugEvent('B', 'source/app.tsx:handleSelectEpisode', 'Selected episode for streaming', {
			itemValue: item.value,
			itemLabel: item.label,
			currentEpisodeIndex,
			selectedEpisodeIndex,
		});
		// #endregion
		const data = await runScraper(['stream', item.value]);
		// #region debug-point B:episode-stream-results
		void debugEvent('B', 'source/app.tsx:handleSelectEpisode', 'Received stream candidates for selected episode', {
			itemValue: item.value,
			streamCount: Array.isArray(data) ? data.length : null,
			streamsPreview: Array.isArray(data) ? data.slice(0, 5) : data,
		});
		// #endregion
		if (data && data.length > 0) {
			const episodeIndex = currentEpisodeIndex >= 0 ? currentEpisodeIndex : selectedEpisodeIndex;
			setEpisodeStreamsState(episodeIndex, data);

			if (data.length === 1) {
				try {
					await playEpisodeSequence(episodeIndex, data, 'source/app.tsx:handleSelectEpisode');
					// #region debug-point C:auto-launch-success
					void debugEvent('C', 'source/app.tsx:handleSelectEpisode', 'Automatic stream launch succeeded', {
						stream: data[0],
						isBrowserTarget: isBrowserStreamTarget(data[0]),
						episodeIndex,
					});
					// #endregion
				} catch {
					// #region debug-point C:auto-launch-failure
					void debugEvent('C', 'source/app.tsx:handleSelectEpisode', 'Automatic stream launch failed', {
						stream: data[0],
						isBrowserTarget: isBrowserStreamTarget(data[0]),
					});
					// #endregion
					setError('Erreur lors du lancement automatique du lecteur.');
				}
			}
		} else {
			setError('Aucun lien de streaming trouvé.');
		}
	};

	const handleSelectStream = async (item: any) => {
		try {
			// #region debug-point C:manual-launch-attempt
			void debugEvent('C', 'source/app.tsx:handleSelectStream', 'Attempting manual stream launch', {
				stream: item.value,
				isBrowserTarget: isBrowserStreamTarget(item.value),
			});
			// #endregion
			if (isBrowserStreamTarget(item.value)) {
				await openExternalUrl(item.value.replace('FRANIME_BROWSER:', ''));
			} else {
				const episodeIndex = activeEpisodeIndex ?? selectedEpisodeIndex;
				await playEpisodeSequence(episodeIndex, [item.value], 'source/app.tsx:handleSelectStream');
			}
			// #region debug-point C:manual-launch-success
			void debugEvent('C', 'source/app.tsx:handleSelectStream', 'Manual stream launch succeeded', {
				stream: item.value,
				isBrowserTarget: isBrowserStreamTarget(item.value),
			});
			// #endregion
		} catch {
			// #region debug-point C:manual-launch-failure
			void debugEvent('C', 'source/app.tsx:handleSelectStream', 'Manual stream launch failed', {
				stream: item.value,
				isBrowserTarget: isBrowserStreamTarget(item.value),
			});
			// #endregion
			setError('Erreur lors du lancement du lecteur.');
		}
	};

	const handleDownload = async (item: any) => {
		setDownloading(true);
		const downloadPath = path.join(os.homedir(), 'Downloads', `${selectedAnime.title}_ep.mp4`);
		const data = await runScraper(['download', item.value, downloadPath]);
		setDownloading(false);
		if (data?.success) {
			setError(`Téléchargement réussi: ${downloadPath}`);
		} else {
			setError('Échec du téléchargement.');
		}
	};

	useInput((input, key) => {
		if (view === 'info') {
			if (key.upArrow) {
				if (episodes.length === 0) {
					return;
				}

				setSelectedEpisodeIndex(index => Math.max(0, index - 1));
				return;
			}

			if (key.downArrow) {
				if (episodes.length === 0) {
					return;
				}

				setSelectedEpisodeIndex(index => Math.min(episodes.length - 1, index + 1));
				return;
			}

			if (key.return) {
				const episode = episodes[selectedEpisodeIndex];
				if (episode) {
					void handleSelectEpisode(episode);
				}

				return;
			}
		}

		if (view === 'streams') {
			if (key.upArrow) {
				if (streams.length === 0) {
					return;
				}

				setSelectedStreamIndex(index => Math.max(0, index - 1));
				return;
			}

			if (key.downArrow) {
				if (streams.length === 0) {
					return;
				}

				setSelectedStreamIndex(index => Math.min(streams.length - 1, index + 1));
				return;
			}

			if (key.return) {
				const stream = streams[selectedStreamIndex];
				if (stream) {
					void handleSelectStream(stream);
				}

				return;
			}
		}

		if (key.escape) {
			if (view === 'results') {
				setView('search');
			} else if (view === 'info') {
				setView('results');
			} else if (view === 'streams') {
				setView('info');
			} else {
				exit();
			}
		}

		if (key.ctrl && input === 'c') {
			exit();
		}

		if (input === 's' && view !== 'search') {
			setView('search');
		}

		if (input === 'q') {
			exit();
		}

		if (input === 'd' && view === 'streams' && streams.length > 0) {
			void handleDownload(streams[selectedStreamIndex] ?? streams[0]);
		}
	});

	const renderHeader = () => (
		<Box paddingX={1} marginBottom={1} borderStyle="single" borderColor="gray">
			<Text color="gray" bold wrap="truncate-end">{isTiny ? 'VIU FR' : ' ⭐︎ VIU FR ⭐︎ '}</Text>
			<Box flexGrow={1} />
			{!isTiny && <Text dimColor wrap="truncate-end">By DALM1</Text>}
		</Box>
	);

	const renderFooter = () => (
		<Box marginTop={1} paddingX={1} borderStyle="single" borderColor="gray" flexDirection={isCompact ? 'column' : 'row'}>
			<Text dimColor wrap="truncate-end">
				{isTiny ? '[ESC] Retour | [Q] Quitter' : '[ESC] Retour | [S] Recherche | [D] Télécharger | [Q] Quitter'}
			</Text>
			{(loading || downloading) && (
				<>
					{!isCompact && <Box flexGrow={1} />}
					<Text color="yellow" wrap="truncate-end">{downloading ? 'Téléchargement...' : 'Chargement...'}</Text>
				</>
			)}
		</Box>
	);

	const renderPoster = () => {
		if (!showPoster) {
			return null;
		}

		return (
			<Box marginBottom={1} overflow="hidden">
				{posterArt ? <Text wrap="truncate">{posterArt}</Text> : <Text dimColor>[Chargement image...]</Text>}
			</Box>
		);
	};

	const renderSelectionDetails = () => {
		if (!selectedAnime) {
			return (
				<Box alignItems="center" justifyContent="center" flexGrow={1}>
					<Text dimColor>Sélectionnez un animé</Text>
				</Box>
			);
		}

		const titleText = clampTextLines(selectedAnime.title, detailTextWidth, 2);
		const romajiText =
			selectedAnime.romaji && selectedAnime.romaji !== selectedAnime.title
				? clampTextLines(selectedAnime.romaji, detailTextWidth, 2)
				: '';
		const metadataText = clampTextLines(
			`Source: ${selectedAnime.source_label || 'inconnue'}${selectedAnime.format ? ` | Format: ${selectedAnime.format}` : ''}`,
			detailTextWidth,
			2,
		);
		const genresText =
			selectedAnime.genres?.length > 0 ? clampTextLines(selectedAnime.genres.join(', '), detailTextWidth, isTiny ? 3 : 4) : '';

		return (
			<Box flexDirection="column" flexGrow={1} overflow="hidden">
				{renderPoster()}
				<Text color="yellow" bold wrap="truncate-end">{titleText}</Text>
				{romajiText && (
					<Text dimColor italic wrap="truncate-end">{romajiText}</Text>
				)}
				<Box marginTop={1} overflow="hidden">
					<Text dimColor wrap="truncate-end">{metadataText}</Text>
				</Box>
				{genresText && (
					<Box marginTop={1} overflow="hidden">
						<Text color="cyan" wrap="truncate-end">{genresText}</Text>
					</Box>
				)}
				<Box marginTop={1} borderStyle="single" borderColor="gray" paddingX={1} overflow="hidden" flexGrow={1}>
					<Text wrap="truncate-end">{synopsisPreview || 'Pas de synopsis disponible.'}</Text>
				</Box>
			</Box>
		);
	};

	return (
		<Box flexDirection="column" paddingX={1} paddingY={isTiny ? 0 : 1} width={outerWidth}>
			{renderHeader()}

			{error && (
				<Box marginBottom={1} paddingX={1}>
					<Text color="red" bold wrap="wrap">{error}</Text>
				</Box>
			)}

			<Box height={mainHeight} flexDirection="column">
				{view === 'search' && (
					<Box
						flexDirection="column"
						borderStyle="round"
						paddingX={isTiny ? 1 : 2}
						paddingY={1}
						width="100%"
						height={mainHeight}
						alignItems="center"
						justifyContent="center"
					>
						<Text color="cyan">{terminalWidth >= 72 ? ASCII_ART : COMPACT_ASCII_ART}</Text>
						<Box marginTop={1}>
							<Text bold color="yellow">RECHERCHER UN ANIME (VF/ENG)</Text>
						</Box>
						<Box marginTop={1} borderStyle="single" paddingX={1} width={inputWidth}>
							<TextInput
								value={query}
								onChange={setQuery}
								onSubmit={handleSearch}
								placeholder="Entrez le nom de l'anime"
							/>
						</Box>
					</Box>
				)}

				{view === 'results' && (
					<Box flexDirection={isTiny ? 'column' : 'row'} width="100%" height={mainHeight}>
						<Box
							flexDirection="column"
							width={isTiny ? '100%' : isCompact ? '48%' : '40%'}
							borderStyle="round"
							paddingX={1}
							borderColor="yellow"
							height={isTiny ? Math.max(8, Math.floor(mainHeight / 2)) : mainHeight}
						>
							<Text color="yellow" bold underline>RÉSULTATS</Text>
							{results.length > 0 ? (
								<SelectInput
									items={results.map(result => ({label: result.title, value: result.id.toString()}))}
									onSelect={handleSelectAnime}
									onHighlight={item => {
										const anime = results.find(result => result.id.toString() === item.value);
										if (anime) {
											setSelectedAnime(anime);
										}
									}}
								/>
							) : (
								<Box marginTop={1}>
									<Text dimColor>{loading ? 'Recherche en cours, ajout des sources au fur et a mesure...' : 'Aucun resultat.'}</Text>
								</Box>
							)}
						</Box>
						<Box
							flexDirection="column"
							width={isTiny ? '100%' : isCompact ? '52%' : '60%'}
							borderStyle="round"
							paddingX={isTiny ? 1 : 2}
							borderColor="gray"
							marginTop={isTiny ? 1 : 0}
							marginLeft={isTiny ? 0 : 1}
							flexGrow={1}
						>
							{renderSelectionDetails()}
						</Box>
					</Box>
				)}

				{view === 'info' && animeInfo && (
					<Box flexDirection={isTiny ? 'column' : 'row'} width="100%" height={mainHeight}>
						<Box
							flexDirection="column"
							width={isTiny ? '100%' : isCompact ? '42%' : '34%'}
							borderStyle="round"
							paddingX={1}
							borderColor="yellow"
							height={infoPaneHeight}
							overflow="hidden"
						>
							<Text color="yellow" bold underline>ÉPISODES</Text>
							<Text dimColor>{`${episodes.length} épisodes | ↑↓ naviguer | Entrée ouvrir`}</Text>
							<Box flexGrow={1} overflow="hidden">
								<ScrollableList
									items={episodes}
									selectedIndex={selectedEpisodeIndex}
									height={episodeListHeight}
									emptyLabel="Aucun épisode disponible."
								/>
							</Box>
						</Box>
						<Box
							flexDirection="column"
							width={isTiny ? '100%' : isCompact ? '58%' : '66%'}
							borderStyle="round"
							paddingX={isTiny ? 1 : 2}
							borderColor="gray"
							marginTop={isTiny ? 1 : 0}
							marginLeft={isTiny ? 0 : 1}
							flexGrow={1}
						>
							{renderSelectionDetails()}
						</Box>
					</Box>
				)}

				{view === 'streams' && (
					<Box flexDirection="column" borderStyle="round" paddingX={isTiny ? 1 : 2} width="100%" height={mainHeight} borderColor="yellow" overflow="hidden">
						<Text color="yellow" bold underline>LECTEURS / TÉLÉCHARGEMENT</Text>
						<Text dimColor wrap="wrap">
							{isTiny ? '↑↓ naviguer | Entrée: lire | D: télécharger' : 'Appuyez sur [↑↓] pour naviguer, [ENTRÉE] pour lire et [D] pour télécharger le lien sélectionné'}
						</Text>
						<Box flexGrow={1} overflow="hidden">
							<ScrollableList
								items={streams}
								selectedIndex={selectedStreamIndex}
								height={streamsListHeight}
								emptyLabel="Aucun lecteur disponible."
							/>
						</Box>
					</Box>
				)}
			</Box>

			{renderFooter()}
		</Box>
	);
};

export default App;
