import { useState, useEffect, useMemo } from 'react';
import { Box, Text, useInput, useApp, useStdout } from 'ink';
import TextInput from 'ink-text-input';
import SelectInput from 'ink-select-input';
import { execa } from 'execa';
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
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [downloading, setDownloading] = useState(false);
	const [posterArt, setPosterArt] = useState<string | null>(null);

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

	const synopsisPreview = useMemo(() => {
		if (!selectedAnime) {
			return '';
		}

		const maxLength = isTiny ? 180 : isCompact ? 320 : 520;
		const synopsis = cleanText(selectedAnime.synopsis);
		return synopsis.length > maxLength ? `${synopsis.slice(0, maxLength - 1)}…` : synopsis;
	}, [selectedAnime, isTiny, isCompact]);

	const runScraper = async (args: string[]) => {
		setLoading(true);
		setError(null);
		try {
			const pythonPath = path.join(process.cwd(), 'venv', 'bin', 'python3');
			const {stdout} = await execa(pythonPath, ['scraper.py', ...args]);
			try {
				return JSON.parse(stdout);
			} catch {
				return stdout;
			}
		} catch (err: any) {
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

	useEffect(() => {
		if (!selectedAnime?.poster || !showPoster) {
			setPosterArt(null);
			return;
		}

		void fetchPosterArt(selectedAnime.poster, posterWidth, posterHeight);
	}, [selectedAnime?.poster, showPoster, posterWidth, posterHeight]);

	const handleSearch = async () => {
		if (!query.trim()) {
			return;
		}

		const data = await runScraper(['search', query]);
		if (data && Array.isArray(data)) {
			setResults(data);
			setSelectedAnime(data[0] ?? null);
			setView('results');
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
			setView('info');
		}
	};

	const handleSelectEpisode = async (item: any) => {
		const data = await runScraper(['stream', item.value]);
		if (data && data.length > 0) {
			setStreams(
				data.map((url: string, index: number) => ({
					label: url.split('/').pop()?.slice(0, isTiny ? 24 : 36) || `Lecteur ${index + 1}`,
					value: url,
				})),
			);
			setView('streams');

			if (data.length === 1) {
				try {
					await execa('mpv', ['--fs', data[0]], {stdio: 'inherit'});
				} catch {
					setError('Erreur lors du lancement automatique de mpv.');
				}
			}
		} else {
			setError('Aucun lien de streaming trouvé.');
		}
	};

	const handleSelectStream = async (item: any) => {
		try {
			await execa('mpv', ['--fs', item.value], {stdio: 'inherit'});
		} catch {
			setError('Erreur lors du lancement de mpv.');
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
			void handleDownload(streams[0]);
		}
	});

	const renderHeader = () => (
		<Box paddingX={1} marginBottom={1} borderStyle="single" borderColor="gray">
			<Text color="gray" bold>{isTiny ? 'VIU FR' : ' ⭐︎ VIU FR ⭐︎ '}</Text>
			<Box flexGrow={1} />
			{!isTiny && <Text dimColor>By DALM1 | AniList API</Text>}
		</Box>
	);

	const renderFooter = () => (
		<Box marginTop={1} paddingX={1} borderStyle="single" borderColor="gray">
			<Text dimColor>
				{isTiny ? '[ESC] Retour | [Q] Quitter' : '[ESC] Retour | [S] Recherche | [D] Télécharger | [Q] Quitter'}
			</Text>
			{(loading || downloading) && (
				<>
					<Box flexGrow={1} />
					<Text color="yellow">{downloading ? 'Téléchargement...' : 'Chargement...'}</Text>
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

		return (
			<Box flexDirection="column" flexGrow={1}>
				{renderPoster()}
				<Text color="yellow" bold>{selectedAnime.title}</Text>
				{selectedAnime.romaji && selectedAnime.romaji !== selectedAnime.title && (
					<Text dimColor italic>{selectedAnime.romaji}</Text>
				)}
				<Box marginTop={1}>
					<Text dimColor>
						Source: {selectedAnime.source_label || 'inconnue'}
						{selectedAnime.format ? ` | Format: ${selectedAnime.format}` : ''}
					</Text>
				</Box>
				{selectedAnime.genres?.length > 0 && (
					<Box marginTop={1}>
						<Text color="cyan">{selectedAnime.genres.join(', ')}</Text>
					</Box>
				)}
				<Box marginTop={1} borderStyle="single" borderColor="gray" paddingX={1}>
					<Text wrap="wrap">{synopsisPreview || 'Pas de synopsis disponible.'}</Text>
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
							height={isTiny ? Math.max(8, Math.floor(mainHeight / 2)) : mainHeight}
						>
							<Text color="yellow" bold underline>ÉPISODES</Text>
							<SelectInput items={episodes} onSelect={handleSelectEpisode} />
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
					<Box flexDirection="column" borderStyle="round" paddingX={isTiny ? 1 : 2} width="100%" height={mainHeight} borderColor="yellow">
						<Text color="yellow" bold underline>LECTEURS / TÉLÉCHARGEMENT</Text>
						<Text dimColor wrap="wrap">
							{isTiny ? 'Entrée: lire | D: télécharger' : 'Appuyez sur [ENTRÉE] pour regarder ou [D] pour télécharger le premier lien'}
						</Text>
						<Box marginTop={1}>
							<SelectInput items={streams} onSelect={handleSelectStream} />
						</Box>
					</Box>
				)}
			</Box>

			{renderFooter()}
		</Box>
	);
};

export default App;
