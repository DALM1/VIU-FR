import React, { useState } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import TextInput from 'ink-text-input';
import SelectInput from 'ink-select-input';
import { execa } from 'execa';
import path from 'path';

const App = () => {
    const { exit } = useApp();
    const [view, setView] = useState('search'); // search, results, episodes, streams
    const [query, setQuery] = useState('');
    const [results, setResults] = useState([]);
    const [episodes, setEpisodes] = useState([]);
    const [streams, setStreams] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [selectedAnime, setSelectedAnime] = useState<any>(null);
    const [selectedEpisode, setSelectedEpisode] = useState<any>(null);

    const runScraper = async (args: string[]) => {
        setLoading(true);
        setError(null);
        try {
            const pythonPath = path.join(process.cwd(), 'venv', 'bin', 'python3');
            const { stdout } = await execa(pythonPath, ['scraper.py', ...args]);
            const data = JSON.parse(stdout);
            if (data.error) throw new Error(data.error);
            return data;
        } catch (err: any) {
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
            setResults(data.map((item: any) => ({ label: item.title, value: item.url })));
            setView('results');
        }
    };

    const handleSelectAnime = async (item: any) => {
        setSelectedAnime(item);
        const data = await runScraper(['episodes', item.value]);
        if (data) {
            setEpisodes(data.map((ep: any) => ({ label: ep.title, value: ep.url })));
            setView('episodes');
        }
    };

    const handleSelectEpisode = async (item: any) => {
        setSelectedEpisode(item);
        const data = await runScraper(['stream', item.value]);
        if (data && data.length > 0) {
            setStreams(data.map((url: string) => ({ label: url.split('/').pop() || url, value: url })));
            setView('streams');
        } else {
            setError("Aucun lien de streaming trouvé.");
        }
    };

    const handleSelectStream = async (item: any) => {
        try {
            await execa('mpv', ['--fs', item.value], { stdio: 'inherit' });
        } catch (err) {
            setError("Erreur lors du lancement de mpv. Est-il installé ?");
        }
    };

    useInput((input, key) => {
        if (key.escape) {
            if (view === 'results') setView('search');
            else if (view === 'episodes') setView('results');
            else if (view === 'streams') setView('episodes');
            else exit();
        }
        if (key.ctrl && input === 'c') {
            exit();
        }
    });

    return (
        <Box flexDirection="column" padding={1} borderStyle="round" borderColor="cyan">
            <Box marginBottom={1}>
                <Text color="yellow" bold>📺 TUI VoirAnime - VF</Text>
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
                            placeholder="Entrez le nom (ex: Soul Eater)"
                        />
                    </Box>
                </Box>
            )}

            {view === 'results' && !loading && (
                <Box flexDirection="column">
                    <Text>Résultats :</Text>
                    <SelectInput items={results} onSelect={handleSelectAnime} />
                </Box>
            )}

            {view === 'episodes' && !loading && (
                <Box flexDirection="column">
                    <Text>Épisodes de {selectedAnime?.label} :</Text>
                    <SelectInput items={episodes} onSelect={handleSelectEpisode} />
                </Box>
            )}

            {view === 'streams' && !loading && (
                <Box flexDirection="column">
                    <Text>Lecteurs disponibles pour {selectedEpisode?.label} :</Text>
                    <SelectInput items={streams} onSelect={handleSelectStream} />
                </Box>
            )}
        </Box>
    );
};

export default App;
