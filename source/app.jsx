import React, {useState, useEffect} from 'react';
import {Box, Text, useInput, useApp} from 'ink';
import TextInput from 'ink-text-input';
import SelectInput from 'ink-select-input';
import {execa} from 'execa';
import path from 'path';

const App = () => {
	const {exit} = useApp();
	const [view, setView] = useState('search'); // search, results, episodes, streaming
	const [query, setQuery] = useState('');
	const [results, setResults] = useState([]);
	const [episodes, setEpisodes] = useState([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState(null);
	const [selectedAnime, setSelectedAnime] = useState(null);

	const runScraper = async args => {
		setLoading(true);
		setError(null);
		try {
			// Utiliser le python du venv
			const pythonPath = path.join(process.cwd(), 'venv', 'bin', 'python3');
			const {stdout} = await execa(pythonPath, ['scraper.py', ...args]);
			const data = JSON.parse(stdout);
			if (data.error) throw new Error(data.error);
			return data;
		} catch (err) {
			setError(err.message);
			return null;
		} finally {
			setLoading(false);
		}
	};

	const handleSearch = async () => {
		if (!query) return;
		const data = await runScraper(['search', query]);
		if (data) {
			setResults(data.map(item => ({label: item.title, value: item.url})));
			setView('results');
		}
	};

	const handleSelectAnime = async item => {
		setSelectedAnime(item);
		const data = await runScraper(['episodes', item.value]);
		if (data) {
			setEpisodes(data.map(ep => ({label: ep.title, value: ep.url})));
			setView('episodes');
		}
	};

	const handleSelectEpisode = async item => {
		const data = await runScraper(['stream', item.value]);
		if (data && data.length > 0) {
			// Pour l'instant on prend le premier lien et on lance mpv
			try {
				// mpv --fs lance en plein écran
				await execa('mpv', ['--fs', data[0]], {stdio: 'inherit'});
			} catch (err) {
				setError('Erreur lors du lancement de mpv. Est-il installé ?');
			}
		} else {
			setError('Aucun lien de streaming trouvé pour cet épisode.');
		}
	};

	useInput((input, key) => {
		if (key.escape) {
			if (view === 'results') setView('search');
			else if (view === 'episodes') setView('results');
			else exit();
		}
		if (key.ctrl && input === 'c') {
			exit();
		}
	});

	return (
		<Box
			flexDirection="column"
			padding={1}
			borderStyle="round"
			borderColor="cyan"
		>
			<Box marginBottom={1}>
				<Text color="yellow" bold>
					📺 TUI VoirAnime - Regarder des animés en VF
				</Text>
			</Box>

			{error && (
				<Box marginBottom={1}>
					<Text color="red">Erreur: {error}</Text>
				</Box>
			)}

			{loading && (
				<Box marginBottom={1}>
					<Text color="blue">Chargement...</Text>
				</Box>
			)}

			{view === 'search' && !loading && (
				<Box flexDirection="column">
					<Text>Rechercher un animé :</Text>
					<Box borderStyle="single" paddingX={1}>
						<TextInput
							value={query}
							onChange={setQuery}
							onSubmit={handleSearch}
							placeholder="Entrez le nom de l'animé (ex: Soul Eater)"
						/>
					</Box>
					<Text color="gray" dimColor>
						Appuyez sur Entrée pour rechercher, ESC pour quitter
					</Text>
				</Box>
			)}

			{view === 'results' && !loading && (
				<Box flexDirection="column">
					<Text>Résultats pour "{query}" :</Text>
					<SelectInput items={results} onSelect={handleSelectAnime} />
					<Text color="gray" dimColor>
						ESC pour revenir à la recherche
					</Text>
				</Box>
			)}

			{view === 'episodes' && !loading && (
				<Box flexDirection="column">
					<Text>Épisodes de {selectedAnime?.label} :</Text>
					<SelectInput items={episodes} onSelect={handleSelectEpisode} />
					<Text color="gray" dimColor>
						ESC pour revenir aux résultats
					</Text>
				</Box>
			)}
		</Box>
	);
};

export default App;
