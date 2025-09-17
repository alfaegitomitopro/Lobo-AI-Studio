import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { GoogleGenAI, Modality } from "@google/genai";

// --- ENUMS & CONSTANTS ---
enum AiTool {
    CREATOR_EDITOR = 'Criador & Editor',
    WATERMARK_REMOVER = 'Remover Marca d\'Água',
    QUALITY_IMPROVER = 'Melhorar Qualidade (2x)',
    IMAGE_EXPANDER = 'Expandir Imagem',
    STYLE_CLONER = 'Clonador de Estilo',
    CHARACTER_CLONER = 'Clonador de Personagem',
    IMAGE_ANIMATOR = 'Animar Imagem',
}

const TOOLS = Object.values(AiTool);

const VIDEO_GENERATION_MESSAGES = [
    "Iniciando o processo de animação...",
    "Analisando a imagem e o prompt...",
    "Gerando os quadros iniciais do vídeo...",
    "Renderizando a sequência de animação...",
    "Aplicando pós-processamento e refinamentos...",
    "Finalizando o vídeo, isso pode levar alguns minutos...",
];

// --- TYPE DEFINITIONS ---
type AspectRatio = '1:1' | '3:4' | '4:3' | '16:9' | '9:16';
const ASPECT_RATIOS: AspectRatio[] = ['1:1', '3:4', '4:3', '16:9', '9:16'];

type HistoryItem = {
    id: string;
    type: 'image' | 'video';
    url: string;
    prompt: string;
    tool: AiTool;
    timestamp: string;
}

// --- PROPS INTERFACES ---
interface ImageUploadProps {
    id: string;
    imageUrl: string | null;
    onUpload: (file: File) => void;
    onClear: () => void;
    label: string;
}
interface LoadingOverlayProps {
    isLoading: boolean;
    message: string;
}
interface AspectRatioSelectorProps {
    selected: AspectRatio;
    onSelect: (ratio: AspectRatio) => void;
}
interface HistoryPanelProps {
    history: HistoryItem[];
    onReuse: (item: HistoryItem, tool: AiTool) => void;
    onDownload: (item: HistoryItem) => void;
    onView: (item: HistoryItem) => void;
}
interface HistoryViewerModalProps {
    item: HistoryItem;
    onClose: () => void;
    onReuse: (item: HistoryItem, tool: AiTool) => void;
    onDownload: (item: HistoryItem) => void;
}


// --- SVG ICONS ---
const LogoIcon = () => (
    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"
        className="text-accent-primary drop-shadow-[0_0_8px_rgba(88,166,255,0.7)]">
        <path d="M11.2312 1.88459C11.6416 1.20411 12.3584 1.20411 12.7688 1.88459L22.2942 17.589C22.7046 18.2695 22.1758 19.125 21.3954 19.125H2.60456C1.82416 19.125 1.29536 18.2695 1.70576 17.589L11.2312 1.88459Z" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M5.5 19L12 8L18.5 19" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
);
const CloseIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>
    </svg>
);
const UploadIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line>
    </svg>
);
const MoreVerticalIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="1"></circle><circle cx="12" cy="5" r="1"></circle><circle cx="12" cy="19" r="1"></circle></svg>
);

// --- HELPER FUNCTIONS ---
const fileToBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve((reader.result as string).split(',')[1]);
        reader.onerror = (error) => reject(error);
    });

const dataUrlToMimeType = (dataUrl: string): string => {
    return dataUrl.substring(dataUrl.indexOf(":") + 1, dataUrl.indexOf(";"));
}
    
const dataUrlToBlob = async (dataUrl: string): Promise<Blob> => {
    const res = await fetch(dataUrl);
    return await res.blob();
};

const createExpansionCanvas = (imageFile: File, targetRatioStr: AspectRatio): Promise<{ base64: string; mimeType: string }> => {
    return new Promise((resolve, reject) => {
        const [w, h] = targetRatioStr.split(':').map(Number);
        const targetRatio = w / h;
        
        const img = new Image();
        const reader = new FileReader();

        reader.onload = (e) => {
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                if (!ctx) return reject(new Error('Could not get canvas context'));

                let canvasWidth, canvasHeight, offsetX, offsetY;
                const imgRatio = img.width / img.height;

                if (targetRatio > imgRatio) { // wider than image
                    canvasHeight = img.height;
                    canvasWidth = img.height * targetRatio;
                    offsetY = 0;
                    offsetX = (canvasWidth - img.width) / 2;
                } else { // taller than image
                    canvasWidth = img.width;
                    canvasHeight = img.width / targetRatio;
                    offsetX = 0;
                    offsetY = (canvasHeight - img.height) / 2;
                }
                
                canvas.width = canvasWidth;
                canvas.height = canvasHeight;

                ctx.drawImage(img, offsetX, offsetY);

                const dataUrl = canvas.toDataURL(imageFile.type);
                resolve({
                    base64: dataUrl.split(',')[1],
                    mimeType: imageFile.type,
                });
            };
            img.src = e.target?.result as string;
        };
        reader.onerror = reject;
        reader.readAsDataURL(imageFile);
    });
};

// --- REUSABLE UI COMPONENTS ---
const LoadingOverlay: React.FC<LoadingOverlayProps> = ({ isLoading, message }) => {
    if (!isLoading) return null;
    return (
        <div className="absolute inset-0 bg-background-primary/50 backdrop-blur-md flex flex-col justify-center items-center z-50 rounded-lg">
            <div className="w-12 h-12 border-4 border-text-secondary border-t-accent-primary rounded-full animate-[spin_1s_linear_infinite]"></div>
            <p className="mt-4 text-text-primary text-center px-2">{message}</p>
        </div>
    );
};
const ImageUpload: React.FC<ImageUploadProps> = ({ id, imageUrl, onUpload, onClear, label }) => {
    const inputRef = useRef<HTMLInputElement>(null);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            onUpload(e.target.files[0]);
        }
    };

    return (
        <div className="w-full">
            <label className="block text-sm font-medium text-text-secondary mb-2">{label}</label>
            <div className="relative aspect-square w-full bg-background-tertiary rounded-lg border-2 border-dashed border-border-color flex items-center justify-center text-text-secondary overflow-hidden">
                {imageUrl ? (
                    <>
                        <img src={imageUrl} alt="Preview" className="w-full h-full object-contain" />
                        <button onClick={onClear} aria-label="Limpar imagem" className="absolute top-2 right-2 p-1 bg-background-primary/50 rounded-full text-text-primary hover:bg-error-color hover:text-white transition-colors">
                            <CloseIcon />
                        </button>
                    </>
                ) : (
                    <button type="button" aria-label="Carregar Imagem" className="text-center" onClick={() => inputRef.current?.click()}>
                        <UploadIcon />
                        <p>Carregar Imagem</p>
                    </button>
                )}
                <input
                    id={id}
                    ref={inputRef}
                    type="file"
                    accept="image/*,video/*"
                    className="hidden"
                    onChange={handleFileChange}
                />
            </div>
        </div>
    );
};
const AspectRatioSelector: React.FC<AspectRatioSelectorProps> = ({ selected, onSelect }) => (
    <div className="my-4">
        <label className="block text-sm font-medium text-text-secondary mb-2">Proporção da Imagem</label>
        <div className="grid grid-cols-5 gap-2">
            {ASPECT_RATIOS.map((ratio) => (
                <button
                    key={ratio}
                    type="button"
                    onClick={() => onSelect(ratio)}
                    className={`py-2 px-1 text-sm rounded-md transition-colors border ${
                        selected === ratio
                            ? 'bg-accent-primary border-accent-primary text-white font-semibold'
                            : 'bg-background-tertiary border-border-color hover:border-accent-primary'
                    }`}
                    aria-pressed={selected === ratio}
                >
                    {ratio}
                </button>
            ))}
        </div>
    </div>
);
const HistoryPanel: React.FC<HistoryPanelProps> = ({ history, onReuse, onDownload, onView }) => {
    const [openMenu, setOpenMenu] = useState<string | null>(null);
    const menuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                setOpenMenu(null);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    const toggleMenu = (id: string) => {
        setOpenMenu(openMenu === id ? null : id);
    };

    return (
        <aside className="sidebar bg-background-secondary backdrop-blur-lg border border-border-color rounded-lg p-4 self-start">
            <h2 className="text-lg font-semibold mb-4">Histórico</h2>
            {history.length === 0 ? (
                 <p className="text-text-secondary text-sm">Nenhum item gerado ainda.</p>
            ) : (
                <ul className="space-y-3 max-h-[80vh] overflow-y-auto">
                    {history.map((item) => (
                        <li key={item.id} className="bg-background-tertiary rounded-md p-2 flex items-center space-x-3">
                            <button onClick={() => onView(item)} className="w-16 h-16 flex-shrink-0 focus:outline-none focus:ring-2 focus:ring-accent-primary rounded-md" aria-label={`Ver item ${item.tool}`}>
                               {item.type === 'image' ? (
                                    <img src={item.url} alt="Histórico" className="w-full h-full object-cover rounded-md" />
                                ) : (
                                    <video src={item.url} className="w-full h-full object-cover rounded-md" />
                                )}
                           </button>
                           <div className="flex-grow overflow-hidden">
                                <p className="text-sm font-medium truncate">{item.tool}</p>
                                <p className="text-xs text-text-secondary truncate">{item.timestamp}</p>
                           </div>
                            <div className="relative" ref={menuRef}>
                                <button onClick={() => toggleMenu(item.id)} className="p-1 rounded-full hover:bg-border-color" aria-label="Mais opções">
                                    <MoreVerticalIcon />
                                </button>
                                {openMenu === item.id && (
                                    <div className="absolute right-0 mt-2 w-48 bg-background-tertiary border border-border-color rounded-md shadow-lg z-10">
                                        <button onClick={() => { onReuse(item, item.tool); setOpenMenu(null); }} className="block w-full text-left px-4 py-2 text-sm text-text-primary hover:bg-border-color">Reutilizar</button>
                                        {item.type === 'image' && (
                                            <button onClick={() => { onReuse(item, AiTool.QUALITY_IMPROVER); setOpenMenu(null); }} className="block w-full text-left px-4 py-2 text-sm text-text-primary hover:bg-border-color">Melhorar (Upscale)</button>
                                        )}
                                        <button onClick={() => { onDownload(item); setOpenMenu(null); }} className="block w-full text-left px-4 py-2 text-sm text-text-primary hover:bg-border-color">Salvar</button>
                                    </div>
                                )}
                            </div>
                        </li>
                    ))}
                </ul>
            )}
        </aside>
    );
};
const HistoryViewerModal: React.FC<HistoryViewerModalProps> = ({ item, onClose, onReuse, onDownload }) => {
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                onClose();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onClose]);

    return (
        <div 
            className="fixed inset-0 bg-black/70 backdrop-blur-sm flex justify-center items-center z-50 p-4"
            onClick={onClose}
            aria-modal="true"
            role="dialog"
        >
            <div 
                className="relative bg-background-tertiary rounded-lg shadow-glow max-w-4xl w-full max-h-[90vh] flex flex-col p-4"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex-grow flex items-center justify-center overflow-hidden mb-4">
                     {item.type === 'image' ? (
                        <img src={item.url} alt={item.prompt} className="max-w-full max-h-full object-contain rounded-md" />
                    ) : (
                        <video src={item.url} controls autoPlay loop className="max-w-full max-h-full object-contain rounded-md" />
                    )}
                </div>
                <div className="flex-shrink-0 flex items-center justify-center space-x-2 flex-wrap gap-2">
                    <button onClick={() => { onReuse(item, item.tool); onClose(); }} className="bg-background-secondary hover:bg-border-color text-text-primary font-semibold py-2 px-4 rounded-md transition-colors">Reutilizar</button>
                    {item.type === 'image' && (
                        <button onClick={() => { onReuse(item, AiTool.QUALITY_IMPROVER); onClose(); }} className="bg-background-secondary hover:bg-border-color text-text-primary font-semibold py-2 px-4 rounded-md transition-colors">Melhorar (Upscale)</button>
                    )}
                    <button onClick={() => { onDownload(item); }} className="bg-accent-primary hover:bg-accent-hover text-white font-bold py-2 px-4 rounded-md transition-colors">Salvar</button>
                </div>
                <button onClick={onClose} aria-label="Fechar visualizador" className="absolute top-2 right-2 p-2 bg-background-primary/50 rounded-full text-text-primary hover:bg-error-color hover:text-white transition-colors">
                    <CloseIcon />
                </button>
            </div>
        </div>
    );
};

// --- MAIN APP COMPONENT ---
export default function App() {
    // --- STATE ---
    const [tool, setTool] = useState<AiTool>(AiTool.CREATOR_EDITOR);
    const [prompt, setPrompt] = useState<string>('');
    const [sourceImage, setSourceImage] = useState<File | null>(null);
    const [styleImage, setStyleImage] = useState<File | null>(null);
    const [sourceImageUrl, setSourceImageUrl] = useState<string | null>(null);
    const [styleImageUrl, setStyleImageUrl] = useState<string | null>(null);
    const [resultImage, setResultImage] = useState<string | null>(null);
    const [resultVideoUrl, setResultVideoUrl] = useState<string | null>(null);
    const [aspectRatio, setAspectRatio] = useState<AspectRatio>('1:1');
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [loadingMessage, setLoadingMessage] = useState<string>('');
    const [error, setError] = useState<string>('');
    const [history, setHistory] = useState<HistoryItem[]>([]);
    const [viewingHistoryItem, setViewingHistoryItem] = useState<HistoryItem | null>(null);


    // --- REFS & MEMO ---
    const ai = useMemo(() => {
        if (!process.env.API_KEY) {
            setError("Chave de API não encontrada.");
            return null;
        }
        return new GoogleGenAI({ apiKey: process.env.API_KEY });
    }, []);

    // --- HELPER & HANDLER FUNCTIONS ---
    const resetState = useCallback((keepImages = false) => {
        setPrompt('');
        if (!keepImages) {
            setSourceImage(null);
            setStyleImage(null);
            setSourceImageUrl(null);
            setStyleImageUrl(null);
        }
        setResultImage(null);
        setResultVideoUrl(null);
        setError('');
        setAspectRatio('1:1');
    }, []);
    
    const handleFileUpload = useCallback((file: File, setImage: React.Dispatch<React.SetStateAction<File | null>>, setImageUrl: React.Dispatch<React.SetStateAction<string | null>>) => {
        setImage(file);
        const url = URL.createObjectURL(file);
        setImageUrl(url);
    }, []);

    const handleHistoryReuse = async (item: HistoryItem, targetTool: AiTool) => {
        try {
            const blob = await dataUrlToBlob(item.url);
            const file = new File([blob], `history-item-${item.id}.${blob.type.split('/')[1] || 'png'}`, { type: blob.type });
            resetState(true);
            setSourceImage(file);
            setSourceImageUrl(item.url);
            setTool(targetTool);
            if (item.type === 'video' && targetTool !== AiTool.IMAGE_ANIMATOR) {
                // If reusing a video for an image tool, maybe show a warning or clear the image
                console.warn("Reusing video for an image tool.");
            }
        } catch (e) {
            setError(`Erro ao reutilizar item do histórico: ${e instanceof Error ? e.message : String(e)}`);
        }
    };
    
    const handleHistoryDownload = (item: HistoryItem) => {
        const a = document.createElement('a');
        a.href = item.url;
        a.download = `${item.tool.replace(/ /g, '_')}-${item.id}.${item.type === 'image' ? 'png' : 'mp4'}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    };

    // --- EFFECTS ---
    useEffect(() => {
        const currentSourceUrl = sourceImageUrl;
        const currentStyleUrl = styleImageUrl;
        return () => {
            if (currentSourceUrl && currentSourceUrl.startsWith('blob:')) URL.revokeObjectURL(currentSourceUrl);
            if (currentStyleUrl && currentStyleUrl.startsWith('blob:')) URL.revokeObjectURL(currentStyleUrl);
        };
    }, [sourceImageUrl, styleImageUrl]);

    useEffect(() => {
        resetState();
    }, [tool, resetState]);

    const addToHistory = (resultUrl: string, resultType: 'image' | 'video') => {
        const newItem: HistoryItem = {
            id: new Date().getTime().toString(),
            type: resultType,
            url: resultUrl,
            prompt: prompt,
            tool: tool,
            timestamp: new Date().toLocaleString('pt-BR'),
        };
        setHistory(prev => [newItem, ...prev]);
    }

    // --- AI LOGIC FUNCTIONS ---
    const handleCreatorEditor = async () => {
        if (!ai) return;
        if (!prompt) { setError("O prompt não pode estar vazio."); return; }

        if (sourceImage) { // Edit
            const data = await fileToBase64(sourceImage);
            const detailedPrompt = `Sua tarefa é uma edição fotográfica de nível mestre e não destrutiva. Preserve a integridade e o caráter da imagem original enquanto aplica a seguinte edição com precisão cirúrgica. Mantenha o fotorrealismo absoluto, garantindo que a iluminação, sombras, texturas e cores da área editada se fundam perfeitamente com o resto da imagem. Edição solicitada: "${prompt}"`;
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash-image-preview',
                contents: { parts: [{ inlineData: { data, mimeType: sourceImage.type } }, { text: detailedPrompt }] },
                config: { responseModalities: [Modality.IMAGE, Modality.TEXT] },
            });
            const imagePart = response.candidates?.[0]?.content.parts.find(p => p.inlineData);
            if (imagePart?.inlineData) {
                const imageUrl = `data:${imagePart.inlineData.mimeType};base64,${imagePart.inlineData.data}`;
                setResultImage(imageUrl);
                addToHistory(imageUrl, 'image');
            } else { setError("Não foi possível editar a imagem."); }
        } else { // Create
            const finalPrompt = `Fotografia hiper-realista, qualidade de lente prime, 8K, hiperdetalhado. Composição magistral, profundidade de campo cinematográfica, iluminação de três pontos, texturas de superfície intrincadas e grão de filme sutil para realismo máximo. Renderizado com Octane. Evite artefatos de IA. ${prompt}`;
            const response = await ai.models.generateImages({
                model: 'imagen-4.0-generate-001',
                prompt: finalPrompt,
                config: { numberOfImages: 1, outputMimeType: 'image/png', aspectRatio: aspectRatio },
            });
            const base64ImageBytes = response.generatedImages[0].image.imageBytes;
            const imageUrl = `data:image/png;base64,${base64ImageBytes}`;
            setResultImage(imageUrl);
            addToHistory(imageUrl, 'image');
        }
    };
    
    const processImageWithPrompt = async (modelPrompt: string) => {
        if (!ai || !sourceImage) return;
        const data = await fileToBase64(sourceImage);
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash-image-preview',
            contents: { parts: [{ text: modelPrompt }, { inlineData: { data, mimeType: sourceImage.type } }] },
            config: { responseModalities: [Modality.IMAGE, Modality.TEXT] },
        });
        const imagePart = response.candidates?.[0]?.content.parts.find(p => p.inlineData);
        if (imagePart?.inlineData) {
            const imageUrl = `data:${imagePart.inlineData.mimeType};base64,${imagePart.inlineData.data}`;
            setResultImage(imageUrl);
            addToHistory(imageUrl, 'image');
        } else {
            throw new Error("A IA não retornou uma imagem editada.");
        }
    }
    
    const handleWatermarkRemover = () => processImageWithPrompt("Sua tarefa é uma remoção de marca d'água de nível profissional. Analise a imagem para identificar quaisquer marcas d'água, logotipos ou sobreposições de texto. Use técnicas de inpainting avançadas para reconstruir de forma inteligente as áreas subjacentes, garantindo que a textura, a cor e a iluminação da área reparada se misturem perfeitamente com o entorno. O resultado deve ser uma imagem limpa e impecável, sem artefatos ou vestígios da remoção.");
    const handleQualityImprover = () => processImageWithPrompt("Realize um aprimoramento de imagem de nível de estúdio (upscale 2x). Sua missão é a reconstrução de textura e o aprimoramento de micro-contraste. Use IA para inferir e gerar detalhes fotorrealistas que foram perdidos. Aumente a nitidez de forma inteligente, focando nas bordas sem criar halos. Aplique redução de ruído que distinga entre ruído e textura fina. Otimize a gama de cores e o balanço de branco para um resultado profissional e vibrante. A imagem final deve ter clareza e detalhes impecáveis, como se fosse de uma fonte de resolução nativa superior.");

    const handleImageExpander = async () => {
        if (!ai || !sourceImage) return;
        
        const { base64, mimeType } = await createExpansionCanvas(sourceImage, aspectRatio);

        const detailedPrompt = `Sua tarefa é um 'outpainting' fotorrealista e contextual. A imagem fornecida é um recorte de uma cena maior. Sua missão é preencher as áreas em branco, estendendo a cena original com coesão absoluta. A transição entre o original e o gerado deve ser invisível. Mantenha rigorosamente a mesma iluminação, textura, profundidade de campo, estilo e, crucialmente, a consistência de perspectiva e escala. O resultado deve ser uma imagem única e expansiva, com realismo impecável. Contexto para a expansão: "${prompt || 'expanda a cena de forma lógica e natural'}"`;
        
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash-image-preview',
            contents: { parts: [{ text: detailedPrompt }, { inlineData: { data: base64, mimeType: mimeType } }] },
            config: { responseModalities: [Modality.IMAGE, Modality.TEXT] },
        });
        const imagePart = response.candidates?.[0]?.content.parts.find(p => p.inlineData);
        if (imagePart?.inlineData) {
            const imageUrl = `data:${imagePart.inlineData.mimeType};base64,${imagePart.inlineData.data}`;
            setResultImage(imageUrl);
            addToHistory(imageUrl, 'image');
        } else { setError("Não foi possível expandir a imagem."); }
    };
    
    const handleStyleCloner = async () => {
        if (!ai || !sourceImage || !styleImage) return;
        const sourceData = await fileToBase64(sourceImage);
        const styleData = await fileToBase64(styleImage);
        const detailedPrompt = "Esta é uma tarefa de transferência de estilo de alta precisão. A primeira imagem é o 'conteúdo'. A segunda imagem é a 'referência de estilo'. Sua missão é dissecar os elementos estilísticos fundamentais da imagem de referência: a paleta de cores exata, a textura das pinceladas ou grão, a qualidade e direção da iluminação, o contraste e a atmosfera geral. Em seguida, aplique essa 'alma' estilística à imagem de conteúdo, reconstruindo-a visualmente sem alterar seus objetos e composição fundamental. O resultado deve parecer que o artista da imagem de estilo pintou o assunto da imagem de conteúdo.";
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash-image-preview',
            contents: { parts: [
                { text: detailedPrompt },
                { inlineData: { data: sourceData, mimeType: sourceImage.type } },
                { inlineData: { data: styleData, mimeType: styleImage.type } },
            ] },
            config: { responseModalities: [Modality.IMAGE, Modality.TEXT] },
        });
        const imagePart = response.candidates?.[0]?.content.parts.find(p => p.inlineData);
        if (imagePart?.inlineData) {
            const imageUrl = `data:${imagePart.inlineData.mimeType};base64,${imagePart.inlineData.data}`;
            setResultImage(imageUrl);
            addToHistory(imageUrl, 'image');
        } else { setError("Não foi possível clonar o estilo."); }
    };

    const handleCharacterCloner = async () => {
        if (!ai || !sourceImage || !prompt) { setError("Por favor, carregue uma imagem do personagem e forneça um prompt."); return; }
        const sourceData = await fileToBase64(sourceImage);
        const detailedPrompt = `Sua tarefa é a clonagem de identidade de personagem com precisão forense. A imagem fornecida contém um personagem-alvo. Realize uma análise profunda da identidade visual: estrutura facial, micro-expressões, textura da pele e cabelo, cor dos olhos e tipo físico. Sua missão é recriar este mesmo personagem em um novo contexto, mantendo consistência absoluta. A iluminação sobre o personagem deve se adaptar perfeitamente ao novo ambiente, projetando sombras e reflexos realistas. O resultado deve ser uma imagem fotorrealista indistinguível de uma fotografia real. Cenário: "${prompt}". Proporção: ${aspectRatio}.`;

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash-image-preview',
            contents: { parts: [{ text: detailedPrompt }, { inlineData: { data: sourceData, mimeType: sourceImage.type } }] },
            config: { responseModalities: [Modality.IMAGE, Modality.TEXT] },
        });
        const imagePart = response.candidates?.[0]?.content.parts.find(p => p.inlineData);
        if (imagePart?.inlineData) {
            const imageUrl = `data:${imagePart.inlineData.mimeType};base64,${imagePart.inlineData.data}`;
            setResultImage(imageUrl);
            addToHistory(imageUrl, 'image');
        } else { setError("Não foi possível clonar o personagem."); }
    };
    
    const handleAnimateImage = async () => {
        if (!ai) return;
        const apiKey = process.env.API_KEY;
        if (!apiKey) {
            setError("Chave de API não encontrada.");
            return;
        }
        let imagePayload;
        if (sourceImage) {
            imagePayload = { imageBytes: await fileToBase64(sourceImage), mimeType: sourceImage.type };
        }

        const finalPrompt = `Crie uma animação de vídeo cinematográfica de alta fidelidade. Se uma imagem for fornecida, anime-a com movimentos sutis e realistas ('live photo' effect), respeitando a física da cena e a profundidade (efeito paralaxe). Se não houver imagem, gere o vídeo. Incorpore movimentos de câmera suaves (como um leve pan ou dolly zoom) para adicionar dinamismo. Foque em animações de partículas (poeira, luz) para aumentar a atmosfera. O resultado deve ser um clipe de vídeo com movimentos fluidos e iluminação dinâmica. Prompt do usuário: "${prompt || 'Anime esta imagem com um movimento sutil e cinematográfico.'}"`;

        let operation = await ai.models.generateVideos({
            model: 'veo-2.0-generate-001',
            prompt: finalPrompt,
            ...(imagePayload && { image: imagePayload }),
            config: { numberOfVideos: 1 },
        });
        
        let messageIndex = 0;
        while (!operation.done) {
            setLoadingMessage(VIDEO_GENERATION_MESSAGES[messageIndex % VIDEO_GENERATION_MESSAGES.length]);
            messageIndex++;
            await new Promise(resolve => setTimeout(resolve, 10000));
            operation = await ai.operations.getVideosOperation({ operation: operation });
        }

        const downloadLink = operation.response?.generatedVideos?.[0]?.video?.uri;
        if (downloadLink) {
            const videoUrl = `${downloadLink}&key=${apiKey}`;
            const blob = await dataUrlToBlob(videoUrl);
            const blobUrl = URL.createObjectURL(blob);
            setResultVideoUrl(blobUrl);
            addToHistory(blobUrl, 'video');
        } else { setError("Falha ao gerar o vídeo."); }
    };
    
    const runAI = async (task: () => Promise<void>, message: string) => {
        if (!ai) {
            setError("API não inicializada. Verifique se a chave de API está configurada.");
            return;
        }
        setIsLoading(true);
        setLoadingMessage(message);
        setError('');
        setResultImage(null);
        setResultVideoUrl(null);

        const maxRetries = 2;
        const initialDelay = 2000; // 2 seconds

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                await task();
                // Success
                setIsLoading(false);
                return;
            } catch (e) {
                console.error(`Attempt ${attempt + 1} failed:`, e);
                const errorMessage = e instanceof Error ? e.message : String(e);

                const isRateLimitError = errorMessage.includes('429') || /RESOURCE_EXHAUSTED/i.test(errorMessage);

                if (isRateLimitError && attempt < maxRetries) {
                    const delay = initialDelay * Math.pow(2, attempt);
                    setLoadingMessage(`Limite de API atingido. Tentando novamente em ${delay / 1000}s...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                } else {
                    // Final attempt failed or it's a different error
                    if (isRateLimitError) {
                        setError(`Cota de Uso Excedida. A API gratuita tem um limite de solicitações por minuto. Tentamos algumas vezes, mas o erro persiste. Por favor, aguarde um pouco antes de tentar novamente.`);
                    } else {
                        setError(`Ocorreu um erro: ${errorMessage}`);
                    }
                    setIsLoading(false);
                    return;
                }
            }
        }
    };

    // --- RENDER LOGIC ---
    const renderControls = () => {
        const commonButtonClasses = "w-full mt-4 bg-accent-primary text-white font-bold py-2 px-4 rounded-md hover:bg-accent-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed";
        
        switch (tool) {
            case AiTool.CREATOR_EDITOR:
                return (
                    <>
                        <p className="text-text-secondary mb-4">Crie uma imagem do zero com um prompt ou edite uma imagem existente.</p>
                        <ImageUpload id="source" imageUrl={sourceImageUrl} onUpload={(f) => handleFileUpload(f, setSourceImage, setSourceImageUrl)} onClear={() => { setSourceImage(null); setSourceImageUrl(null); }} label="Imagem Fonte (Opcional)" />
                        {!sourceImageUrl && <AspectRatioSelector selected={aspectRatio} onSelect={setAspectRatio} />}
                        <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Ex: Um lobo em uma floresta neon..." className="w-full h-32 mt-4 bg-background-tertiary border border-border-color rounded-md p-2 focus:outline-none focus:ring-2 focus:ring-accent-primary"></textarea>
                        <button onClick={() => runAI(handleCreatorEditor, 'Gerando imagem...')} className={commonButtonClasses} disabled={isLoading || !prompt}>Executar</button>
                    </>
                );
            case AiTool.WATERMARK_REMOVER:
                 return (
                    <>
                        <p className="text-text-secondary mb-4">Carregue uma imagem para remover a marca d'água automaticamente.</p>
                        <ImageUpload id="source" imageUrl={sourceImageUrl} onUpload={(f) => handleFileUpload(f, setSourceImage, setSourceImageUrl)} onClear={() => { setSourceImage(null); setSourceImageUrl(null); }} label="Imagem com Marca d'Água" />
                        <button onClick={() => runAI(handleWatermarkRemover, 'Removendo marca d\'água...')} className={commonButtonClasses} disabled={isLoading || !sourceImage}>Executar</button>
                    </>
                );
            case AiTool.QUALITY_IMPROVER:
                return (
                    <>
                        <p className="text-text-secondary mb-4">Melhore a resolução e a nitidez da sua imagem automaticamente.</p>
                        <ImageUpload id="source" imageUrl={sourceImageUrl} onUpload={(f) => handleFileUpload(f, setSourceImage, setSourceImageUrl)} onClear={() => { setSourceImage(null); setSourceImageUrl(null); }} label="Imagem para Melhorar" />
                        <button onClick={() => runAI(handleQualityImprover, 'Melhorando qualidade...')} className={commonButtonClasses} disabled={isLoading || !sourceImage}>Executar</button>
                    </>
                );
            case AiTool.IMAGE_EXPANDER:
                return (
                    <>
                        <p className="text-text-secondary mb-4">Expanda sua imagem para uma nova proporção, preenchendo o espaço de forma inteligente.</p>
                        <ImageUpload id="source" imageUrl={sourceImageUrl} onUpload={(f) => handleFileUpload(f, setSourceImage, setSourceImageUrl)} onClear={() => { setSourceImage(null); setSourceImageUrl(null); }} label="Imagem para Expandir" />
                        <AspectRatioSelector selected={aspectRatio} onSelect={setAspectRatio} />
                        <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Contexto para a expansão (opcional)..." className="w-full h-20 mt-2 bg-background-tertiary border border-border-color rounded-md p-2 focus:outline-none focus:ring-2 focus:ring-accent-primary"></textarea>
                        <button onClick={() => runAI(handleImageExpander, 'Expandindo imagem...')} className={commonButtonClasses} disabled={isLoading || !sourceImage}>Executar</button>
                    </>
                );
            case AiTool.STYLE_CLONER:
                 return (
                    <>
                        <p className="text-text-secondary mb-4">Transfira o estilo de uma imagem para outra.</p>
                        <div className="flex space-x-4">
                            <ImageUpload id="source" imageUrl={sourceImageUrl} onUpload={(f) => handleFileUpload(f, setSourceImage, setSourceImageUrl)} onClear={() => { setSourceImage(null); setSourceImageUrl(null); }} label="Imagem Conteúdo" />
                            <ImageUpload id="style" imageUrl={styleImageUrl} onUpload={(f) => handleFileUpload(f, setStyleImage, setStyleImageUrl)} onClear={() => { setStyleImage(null); setStyleImageUrl(null); }} label="Imagem Estilo" />
                        </div>
                        <button onClick={() => runAI(handleStyleCloner, 'Clonando estilo...')} className={commonButtonClasses} disabled={isLoading || !sourceImage || !styleImage}>Executar</button>
                    </>
                );
            case AiTool.CHARACTER_CLONER:
                return (
                    <>
                        <p className="text-text-secondary mb-4">Mantenha a pessoa e mude o cenário, a roupa ou a ação.</p>
                        <ImageUpload id="source" imageUrl={sourceImageUrl} onUpload={(f) => handleFileUpload(f, setSourceImage, setSourceImageUrl)} onClear={() => { setSourceImage(null); setSourceImageUrl(null); }} label="Imagem do Personagem" />
                        <AspectRatioSelector selected={aspectRatio} onSelect={setAspectRatio} />
                        <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Ex: Vestindo uma armadura dourada em um castelo..." className="w-full h-20 mt-2 bg-background-tertiary border border-border-color rounded-md p-2 focus:outline-none focus:ring-2 focus:ring-accent-primary"></textarea>
                        <button onClick={() => runAI(handleCharacterCloner, 'Clonando personagem...')} className={commonButtonClasses} disabled={isLoading || !sourceImage || !prompt}>Executar</button>
                    </>
                );
            case AiTool.IMAGE_ANIMATOR:
                return (
                    <>
                        <p className="text-text-secondary mb-4">Dê vida à sua imagem com uma animação em vídeo.</p>
                        <ImageUpload id="source" imageUrl={sourceImageUrl} onUpload={(f) => handleFileUpload(f, setSourceImage, setSourceImageUrl)} onClear={() => { setSourceImage(null); setSourceImageUrl(null); }} label="Imagem para Animar (Opcional)" />
                        <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Descreva o movimento desejado..." className="w-full h-20 mt-4 bg-background-tertiary border border-border-color rounded-md p-2 focus:outline-none focus:ring-2 focus:ring-accent-primary"></textarea>
                        <button onClick={() => runAI(handleAnimateImage, 'Iniciando animação...')} className={commonButtonClasses} disabled={isLoading || (!sourceImage && !prompt)}>Executar</button>
                    </>
                );
            default:
                return null;
        }
    };
    
    return (
        <div className="min-h-screen bg-background-primary font-sans text-text-primary p-4 lg:p-8">
            <header className="flex items-center space-x-4 mb-8">
                <LogoIcon />
                <h1 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-accent-hover to-accent-primary drop-shadow-[0_0_8px_rgba(88,166,255,0.7)]">
                    Lobo AI Studio
                </h1>
            </header>
            <main className="grid grid-cols-1 md:grid-cols-[300px_1fr] lg:grid-cols-[300px_1fr_300px] gap-8">
                <aside className="sidebar bg-background-secondary backdrop-blur-lg border border-border-color rounded-lg p-4 self-start">
                    <h2 className="text-lg font-semibold mb-4">Ferramentas</h2>
                    <ul className="space-y-2">
                        {TOOLS.map((t) => (
                            <li key={t}>
                                <button
                                    onClick={() => setTool(t)}
                                    className={`w-full text-left px-4 py-2 rounded-md transition-colors ${tool === t ? 'bg-accent-primary text-white font-semibold' : 'hover:bg-background-tertiary'}`}
                                    aria-current={tool === t}
                                >
                                    {t}
                                </button>
                            </li>
                        ))}
                    </ul>
                </aside>
                <section className="main-content grid grid-cols-1 xl:grid-cols-2 gap-8">
                    <div className="controls bg-background-secondary backdrop-blur-lg border border-border-color rounded-lg p-6 self-start">
                        <h2 className="text-xl font-bold mb-2">{tool}</h2>
                        {error && <div role="alert" className="bg-error-color/20 text-error-color p-3 rounded-md mb-4">{error}</div>}
                        {renderControls()}
                    </div>
                    <div className="result-area relative aspect-square bg-background-tertiary border border-border-color rounded-lg flex items-center justify-center p-2">
                        <LoadingOverlay isLoading={isLoading} message={loadingMessage} />
                        {!resultImage && !resultVideoUrl && (
                             <div className="text-center text-text-secondary">
                                <p>O resultado aparecerá aqui</p>
                            </div>
                        )}
                        {resultImage && (
                            <img src={resultImage} alt="Resultado da IA" className="max-w-full max-h-full object-contain rounded-md" />
                        )}
                        {resultVideoUrl && (
                            <video src={resultVideoUrl} controls autoPlay loop className="max-w-full max-h-full object-contain rounded-md"></video>
                        )}
                    </div>
                </section>
                <HistoryPanel 
                    history={history} 
                    onReuse={handleHistoryReuse} 
                    onDownload={handleHistoryDownload}
                    onView={setViewingHistoryItem}
                />
            </main>
            {viewingHistoryItem && (
                <HistoryViewerModal 
                    item={viewingHistoryItem}
                    onClose={() => setViewingHistoryItem(null)}
                    onReuse={handleHistoryReuse}
                    onDownload={handleHistoryDownload}
                />
            )}
        </div>
    );
}