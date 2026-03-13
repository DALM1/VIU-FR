import React, { useState } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
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

const App = () => {
    const { exit } = useApp();
    const [view, setView] = useState('search'); // search, results, info, streams
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<any[]>([]);
    const [selectedAnime, setSelectedAnime] = useState<any>(null);
    const [animeInfo, setAnimeInfo] = useState<any>(null);
    const [episodes, setEpisodes] = useState<any[]>([]);
    const [streams, setStreams] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [downloading, setDownloading] = useState(false);

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
            setResults(data);
            setView('results');
        }
    };

    const handleSelectAnime = async (item: any) => {
        const anime = results.find(r => r.id.toString() === item.value);
        setSelectedAnime(anime);
        const data = await runScraper(['info', anime.url]);
        if (data) {
            setAnimeInfo(data);
            setEpisodes(data.episodes.map((ep: any) => ({ label: ep.title, value: ep.url })));
            setView('info');
        }
    };

    const handleSelectEpisode = async (item: any) => {
        const data = await runScraper(['stream', item.value]);
        if (data && data.length > 0) {
            setStreams(data.map((url: string) => ({ label: url.split('/').pop()?.substring(0, 30) || url, value: url })));
            setView('streams');

            // Lancement automatique si un seul lien est trouvé (comme avant)
            if (data.length === 1) {
                try {
                    await execa('mpv', ['--fs', data[0]], { stdio: 'inherit' });
                } catch (err) {
                    setError("Erreur lors du lancement automatique de mpv.");
                }
            }
        } else {
            setError("Aucun lien de streaming trouvé.");
        }
    };

    const handleSelectStream = async (item: any) => {
        // Option simple: regarder par défaut. On pourrait ajouter un menu "Regarder / Télécharger"
        try {
            await execa('mpv', ['--fs', item.value], { stdio: 'inherit' });
        } catch (err) {
            setError("Erreur lors du lancement de mpv.");
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
            setError("Échec du téléchargement.");
        }
    };

    useInput((input, key) => {
        if (key.escape) {
            if (view === 'results') setView('search');
            else if (view === 'info') setView('results');
            else if (view === 'streams') setView('info');
            else exit();
        }
        if (key.ctrl && input === 'c') exit();
        if (input === 's' && view !== 'search') setView('search');
        if (input === 'q') exit();
        if (input === 'd' && view === 'streams') {
            // Télécharger le premier lien disponible pour simplifier
            if (streams.length > 0) handleDownload(streams[0]);
        }
    });

    const renderHeader = () => (
        <Box paddingX={1} marginBottom={1} borderStyle="single" borderColor="gray">
            <Text color="gray" bold> ⭐︎ VIU FR ⭐︎ </Text>
            <Box flexGrow={1} />
            <Text dimColor>By DALM1 | AniList API</Text>
        </Box>
    );

    const renderFooter = () => (
        <Box marginTop={1} paddingX={1} borderStyle="single" borderColor="gray">
            <Text dimColor> [ESC] Retour | [S] Recherche | [D] Télécharger | [Q] Quitter </Text>
            {(loading || downloading) && (
                <>
                    <Box flexGrow={1} />
                    <Text color="yellow">{downloading ? "Téléchargement..." : "Chargement..."}</Text>
                </>
            )}
        </Box>
    );

    return (
        <Box flexDirection="column" padding={1} width={120}>
            {renderHeader()}

            {error && (
                <Box marginBottom={1} paddingX={1}>
                    <Text color="red" bold>{error}</Text>
                </Box>
            )}

            <Box height={25}>
                {view === 'search' && (
                    <Box flexDirection="column" borderStyle="round" paddingX={2} paddingY={1} width="100%" alignItems="center" justifyContent="center">
                        <Text color="cyan">{ASCII_ART}</Text>
                        <Box marginTop={1}>
                            <Text bold color="yellow">RECHERCHER UN ANIME (VF/ENG)</Text>
                        </Box>
                        <Box marginTop={1} borderStyle="single" paddingX={1} width={50}>
                            <TextInput
                                value={query}
                                onChange={setQuery}
                                onSubmit={handleSearch}
                                placeholder="Entrez le nom de l'animé"
                            />
                        </Box>
                    </Box>
                )}

                {view === 'results' && (
                    <Box flexDirection="row" width="100%">
                        <Box flexDirection="column" width="40%" borderStyle="round" paddingX={1} borderColor="yellow">
                            <Text color="yellow" bold underline>RÉSULTATS ANILIST</Text>
                            <SelectInput
                                items={results.map(r => ({ label: r.title, value: r.id.toString() }))}
                                onSelect={handleSelectAnime}
                                onHighlight={(item) => {
                                    const anime = results.find(r => r.id.toString() === item.value);
                                    setSelectedAnime(anime);
                                }}
                            />
                        </Box>
                        <Box flexDirection="column" width="60%" borderStyle="round" paddingX={2} borderColor="gray">
                            {selectedAnime ? (
                                <Box flexDirection="column">
                                    <Text color="yellow" bold>{selectedAnime.title}</Text>
                                    <Text dimColor italic>{selectedAnime.romaji}</Text>
                                    <Box marginTop={1} borderStyle="single" borderColor="dim" paddingX={1}>
                                        <Text dimColor italic wrap="wrap">
                                            {selectedAnime.synopsis?.replace(/<[^>]*>?/gm, '') || "Pas de synopsis disponible."}
                                        </Text>
                                    </Box>
                                    <Box marginTop={1}>
                                        <Text color="yellow">Score: {selectedAnime.score}% | Status: {selectedAnime.status}</Text>
                                    </Box>
                                </Box>
                            ) : (
                                <Box alignItems="center" justifyContent="center" height="100%">
                                    <Text dimColor>Sélectionnez un animé</Text>
                                </Box>
                            )}
                        </Box>
                    </Box>
                )}

                {view === 'info' && animeInfo && (
                    <Box flexDirection="row" width="100%">
                        <Box flexDirection="column" width="30%" borderStyle="round" paddingX={1} borderColor="yellow">
                            <Text color="yellow" bold underline>ÉPISODES</Text>
                            <SelectInput items={episodes} onSelect={handleSelectEpisode} />
                        </Box>
                        <Box flexDirection="column" width="70%" borderStyle="round" paddingX={2} borderColor="gray">
                            <Text color="cyan" bold>{selectedAnime.title}</Text>
                            <Box flexDirection="row" marginTop={1}>
                                {selectedAnime.genres.map((g: string) => (
                                    <Box key={g} marginRight={1} paddingX={1}>
                                        <Text color="white" bold backgroundColor="blue">{g}</Text>
                                    </Box>
                                ))}
                            </Box>
                            <Box marginTop={1} borderStyle="single" borderColor="dim" paddingX={1} height={10}>
                                <Text wrap="wrap">{selectedAnime.synopsis?.replace(/<[^>]*>?/gm, '')}</Text>
                            </Box>
                        </Box>
                    </Box>
                )}

                {view === 'streams' && (
                    <Box flexDirection="column" borderStyle="round" paddingX={2} width="100%" borderColor="yellow">
                        <Text color="yellow" bold underline>LECTEURS / TÉLÉCHARGEMENT</Text>
                        <Text dimColor>Appuyez sur [ENTRÉE] pour regarder ou [D] pour télécharger le premier lien</Text>
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
