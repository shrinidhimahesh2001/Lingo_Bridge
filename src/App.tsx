import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  Languages, 
  ArrowRightLeft, 
  Loader2,
  MessageSquare,
  Mic,
  MicOff,
  Info,
  Volume2,
  Users
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Label } from "@/components/ui/label";
import { translateTranscript } from "@/src/lib/gemini";
import { cn } from "@/lib/utils";

const INDIAN_LANGUAGES = [
  "Hindi",
  "Tamil",
  "Telugu",
  "Kannada",
  "Malayalam",
  "Bengali",
  "Marathi",
  "Gujarati",
  "Punjabi",
  "Urdu",
  "English"
];

const LANG_CODE_MAP: Record<string, string> = {
  "English": "en-US",
  "Hindi": "hi-IN",
  "Tamil": "ta-IN",
  "Telugu": "te-IN",
  "Kannada": "kn-IN",
  "Malayalam": "ml-IN",
  "Bengali": "bn-IN",
  "Marathi": "mr-IN",
  "Gujarati": "gu-IN",
  "Punjabi": "pa-IN",
  "Urdu": "ur-PK"
};

export default function App() {
  const [sourceLang, setSourceLang] = useState("English");
  const [targetLang, setTargetLang] = useState("Hindi");
  const [isLoading, setIsLoading] = useState(false);
  const [context, setContext] = useState("");
  
  const [autoContext, setAutoContext] = useState("");
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  
  // STT State
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<any>(null);
  const transcriptRef = useRef("");

  // TTS State
  const [isSpeaking, setIsSpeaking] = useState(false);

  // Sound wave animation component
  const SoundWave = ({ active, color = "bg-blue-500" }: { active: boolean, color?: string }) => (
    <div className="flex items-center gap-[2px] h-4">
      {[1, 2, 3, 4, 5].map((i) => (
        <motion.div
          key={i}
          animate={active ? {
            height: [4, 12, 6, 16, 4][i % 5],
          } : { height: 4 }}
          transition={active ? {
            duration: 0.6,
            repeat: Infinity,
            delay: i * 0.1,
            ease: "easeInOut"
          } : { duration: 0.2 }}
          className={cn("w-[2px] rounded-full", active ? color : "bg-slate-200")}
        />
      ))}
    </div>
  );

  // Conversation Mode State
  const [activeSpeaker, setActiveSpeaker] = useState<"A" | "B" | null>(null);
  const activeSpeakerRef = useRef<"A" | "B" | null>(null);
  const [currentTranscript, setCurrentTranscript] = useState("");
  const [convLogs, setConvLogs] = useState<{ id: number, speaker: string, text: string, translation: string, lang: string, isPending?: boolean }[]>([]);

  // Refs to avoid stale closures in event listeners
  const sourceLangRef = useRef(sourceLang);
  const targetLangRef = useRef(targetLang);
  const contextRef = useRef(context);
  const convLogsRef = useRef(convLogs);

  useEffect(() => { sourceLangRef.current = sourceLang; }, [sourceLang]);
  useEffect(() => { targetLangRef.current = targetLang; }, [targetLang]);
  useEffect(() => { contextRef.current = context; }, [context]);
  useEffect(() => { convLogsRef.current = convLogs; }, [convLogs]);

  // Initialize Speech Recognition and Pre-load TTS voices
  useEffect(() => {
    // Pre-load voices for TTS
    window.speechSynthesis.getVoices();
    const handleVoicesChanged = () => {
      window.speechSynthesis.getVoices();
    };
    window.speechSynthesis.addEventListener('voiceschanged', handleVoicesChanged);

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      
      recognition.onresult = (event: any) => {
        let transcript = "";
        for (let i = 0; i < event.results.length; i++) {
          transcript += event.results[i][0].transcript;
        }
        transcriptRef.current = transcript;
        setCurrentTranscript(transcript);
      };

      recognition.onerror = (event: any) => {
        if (event.error === "no-speech") {
          console.warn("Speech recognition: No speech detected.");
          return;
        }
        
        console.error("Speech recognition error", event.error);
        setError(`Microphone error: ${event.error}`);
        setIsListening(false);
        setActiveSpeaker(null);
        activeSpeakerRef.current = null;
        
        setTimeout(() => setError(null), 5000);
      };

      recognition.onend = () => {
        setIsListening(false);
        const finalTranscript = transcriptRef.current.trim();
        const speaker = activeSpeakerRef.current;
        
        if (finalTranscript && speaker) {
          handleConversationTranslate(finalTranscript, speaker);
        }
        
        setCurrentTranscript("");
        setActiveSpeaker(null);
        activeSpeakerRef.current = null;
      };

      recognitionRef.current = recognition;
    }

    return () => {
      window.speechSynthesis.removeEventListener('voiceschanged', handleVoicesChanged);
    };
  }, []);

  // Update recognition language when source language changes
  useEffect(() => {
    if (recognitionRef.current) {
      recognitionRef.current.lang = LANG_CODE_MAP[sourceLang] || "en-US";
    }
  }, [sourceLang]);

  // TTS State
  useEffect(() => {
    // Cleanup speech synthesis on unmount
    return () => {
      window.speechSynthesis.cancel();
    };
  }, []);

  // Auto-scroll to bottom when logs or transcript change
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [convLogs, currentTranscript]);

  const handleConversationTranslate = async (text: string, speaker: "A" | "B") => {
    const sLang = speaker === "A" ? sourceLangRef.current : targetLangRef.current;
    const tLang = speaker === "A" ? targetLangRef.current : sourceLangRef.current;
    
    const logId = Date.now();
    // Add the transcript immediately
    setConvLogs(prev => [...prev, { 
      id: logId,
      speaker: speaker === "A" ? "Person A" : "Person B", 
      text, 
      translation: "", 
      lang: tLang,
      isPending: true
    }]);

    setIsLoading(true);
    console.log(`[Translation] Request: "${text}" | From: ${sLang} | To: ${tLang}`);
    try {
      const result = await translateTranscript(text, sLang, tLang, contextRef.current, convLogsRef.current);
      
      if (result.context) {
        setAutoContext(result.context);
      }

      setConvLogs(prev => prev.map(log => 
        log.id === logId 
          ? { ...log, translation: result.translatedText, isPending: false } 
          : log
      ));
      // Auto-speak the translation for the other person
      speakText(result.translatedText, tLang);
    } catch (err) {
      console.error("Conv translation error", err);
      // Remove the pending log if it failed or mark it
      setConvLogs(prev => prev.map(log => 
        log.id === logId 
          ? { ...log, translation: "Translation failed. Please try again.", isPending: false } 
          : log
      ));
    } finally {
      setIsLoading(false);
    }
  };

  const speakText = (text: string, langName: string) => {
    if (!text) return;
    
    // Cancel any ongoing speech
    window.speechSynthesis.cancel();
    
    // Small delay to ensure cancel completes and browser is ready
    setTimeout(() => {
      const utterance = new SpeechSynthesisUtterance(text);
      const langCode = LANG_CODE_MAP[langName] || "en-US";
      utterance.lang = langCode;
      
      // Attempt to find a matching voice for the language
      const voices = window.speechSynthesis.getVoices();
      // Try exact match first, then partial match
      let voice = voices.find(v => v.lang === langCode);
      if (!voice) {
        voice = voices.find(v => v.lang.toLowerCase().startsWith(langCode.toLowerCase().split('-')[0]));
      }
      
      if (voice) {
        utterance.voice = voice;
      }
      
      utterance.rate = 0.9; // Slightly slower for clarity
      utterance.pitch = 1;
      
      utterance.onstart = () => setIsSpeaking(true);
      utterance.onend = () => setIsSpeaking(false);
      utterance.onerror = (e) => {
        console.error("Speech synthesis error:", e);
        setIsSpeaking(false);
      };
      
      window.speechSynthesis.speak(utterance);
    }, 150);
  };

  const toggleListening = (speaker: "A" | "B") => {
    if (isListening) {
      recognitionRef.current?.stop();
    } else {
      transcriptRef.current = "";
      setCurrentTranscript("");
      setActiveSpeaker(speaker);
      activeSpeakerRef.current = speaker;
      
      if (recognitionRef.current) {
        recognitionRef.current.lang = LANG_CODE_MAP[speaker === "A" ? sourceLang : targetLang] || "en-US";
        recognitionRef.current.start();
        setIsListening(true);
      }
    }
  };

  const handleSwapLanguages = () => {
    setSourceLang(targetLang);
    setTargetLang(sourceLang);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 selection:bg-blue-100 font-sans">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-50 shadow-sm">
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center shadow-blue-200 shadow-lg">
              <Languages className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-xl font-bold tracking-tight text-slate-800">LingoBridge</h1>
          </div>
          <div className="flex items-center gap-4">
            <AnimatePresence>
              {isSpeaking && (
                <motion.div 
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  className="flex items-center gap-2 bg-blue-600 text-white px-3 py-1 rounded-full text-[10px] font-bold shadow-lg shadow-blue-200"
                >
                  <Volume2 className="w-3 h-3 animate-pulse" />
                  <span>OUTPUTTING AUDIO</span>
                  <SoundWave active={true} color="bg-white" />
                </motion.div>
              )}
            </AnimatePresence>
            <Badge variant="outline" className="hidden sm:flex items-center gap-1.5 border-blue-200 bg-blue-50 text-blue-700 font-bold px-3 py-1">
              <Mic className="w-3 h-3" /> Voice Enabled
            </Badge>
            <Badge variant="secondary" className="bg-slate-100 text-slate-600 font-medium px-3 py-1 border-none">
              v3.2 // Conv Mode
            </Badge>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 pt-6 pb-8 md:pt-8 md:pb-12">
        <div className="flex flex-col gap-6">
          {/* Main Translation Interface */}
          <div className="space-y-6">
            {/* Error Message */}
            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="bg-red-50 border border-red-100 text-red-600 px-4 py-2 rounded-2xl text-xs font-medium flex items-center gap-2"
                >
                  <Info className="w-3 h-3" />
                  {error}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Context Input */}
            <Card className="border-slate-100 shadow-sm overflow-hidden bg-white rounded-3xl">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Info className="w-4 h-4 text-blue-500" />
                    <CardTitle className="text-sm font-semibold text-slate-700">Conversation Context</CardTitle>
                  </div>
                  {autoContext && (
                    <Badge variant="secondary" className="bg-blue-50 text-blue-600 border-none text-[10px] font-bold px-3 py-0.5 animate-in fade-in slide-in-from-right-2">
                      Detected: {autoContext}
                    </Badge>
                  )}
                </div>
                <div className="flex items-center justify-between mt-1">
                  <CardDescription className="text-xs text-slate-500 max-w-[70%]">
                    Providing context helps the AI understand speaker intent for more accurate translations.
                  </CardDescription>
                  <Badge variant="outline" className="text-[10px] font-normal border-amber-100 bg-amber-50 text-amber-600 rounded-full px-3">
                    Tip: Open in new tab for Mic access
                  </Badge>
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="h-6 text-[10px] text-blue-600 hover:bg-blue-50"
                    onClick={() => speakText("Testing audio output", "English")}
                  >
                    Test Audio
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="pt-0 pb-6">
                <Textarea 
                  placeholder="e.g., A business meeting about project deadlines..."
                  className="min-h-[100px] border-slate-100 bg-slate-50/30 focus:ring-0 focus:border-slate-200 rounded-2xl text-sm resize-none"
                  value={context}
                  onChange={(e) => setContext(e.target.value)}
                />
              </CardContent>
            </Card>

            {/* Language Selection Bar */}
            <Card className="border-slate-100 shadow-sm bg-white rounded-3xl p-4">
              <div className="flex flex-col sm:flex-row items-center gap-6">
                <div className="flex-1 w-full">
                  <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1 block px-2">From</Label>
                  <Select value={sourceLang} onValueChange={setSourceLang}>
                    <SelectTrigger className="border-none bg-slate-50/50 focus:ring-0 font-bold text-base h-12 rounded-2xl px-4">
                      <SelectValue placeholder="Source Language" />
                    </SelectTrigger>
                    <SelectContent>
                      {INDIAN_LANGUAGES.map(lang => (
                        <SelectItem key={lang} value={lang}>{lang}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                
                <Button 
                  variant="outline" 
                  size="icon" 
                  onClick={handleSwapLanguages}
                  className="rounded-full border-slate-100 hover:bg-slate-50 h-10 w-10 mt-4 sm:mt-0 shadow-sm"
                >
                  <ArrowRightLeft className="w-4 h-4 text-slate-400" />
                </Button>

                <div className="flex-1 w-full">
                  <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1 block px-2">To</Label>
                  <Select value={targetLang} onValueChange={setTargetLang}>
                    <SelectTrigger className="border-none bg-slate-50/50 focus:ring-0 font-bold text-base h-12 rounded-2xl px-4">
                      <SelectValue placeholder="Target Language" />
                    </SelectTrigger>
                    <SelectContent>
                      {INDIAN_LANGUAGES.map(lang => (
                        <SelectItem key={lang} value={lang}>{lang}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </Card>

            {/* Conversation Interface */}
            <Card className="border-slate-100 shadow-sm bg-white rounded-3xl overflow-hidden flex flex-col h-[500px] sm:h-[550px] md:h-[650px]">
              <CardHeader className="pb-4 border-b border-slate-50">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Users className="w-4 h-4 text-blue-500" />
                    <CardTitle className="text-sm font-bold text-slate-700">
                      {isListening ? (
                        <span className="flex items-center gap-2 text-blue-600">
                          <span className="relative flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
                          </span>
                          Listening to {activeSpeaker === "A" ? "Person A" : "Person B"}...
                        </span>
                      ) : "Real-time Conversation"}
                    </CardTitle>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-[10px] font-bold border-blue-100 bg-blue-50 text-blue-600 rounded-full px-3">
                      {sourceLang} ↔ {targetLang}
                    </Badge>
                    <Button variant="ghost" size="sm" onClick={() => setConvLogs([])} className="h-7 text-[10px] text-slate-400 hover:text-red-500">
                      Clear
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-0 flex-1 min-h-0 overflow-hidden">
                <ScrollArea className="h-full p-6">
                  <div className="space-y-6">
                    {convLogs.length === 0 ? (
                      <div className="h-[350px] flex flex-col items-center justify-center text-center opacity-30 space-y-4">
                        <MessageSquare className="w-12 h-12 text-slate-300" />
                        <p className="text-sm font-medium text-slate-400">Start a conversation between {sourceLang} and {targetLang}</p>
                      </div>
                    ) : (
                      convLogs.map((log, i) => (
                        <motion.div 
                          key={log.id || i} 
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          className={cn(
                            "flex flex-col max-w-[85%] space-y-1",
                            log.speaker === "Person A" ? "mr-auto" : "ml-auto items-end"
                          )}
                        >
                          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-1">
                            {log.speaker}
                          </span>
                          <div className={cn(
                            "p-4 rounded-2xl shadow-sm",
                            log.speaker === "Person A" ? "bg-white border border-slate-100 rounded-tl-none" : "bg-blue-600 text-white rounded-tr-none"
                          )}>
                            <p className="text-sm leading-relaxed">{log.text}</p>
                            <Separator className={cn("my-2", log.speaker === "Person A" ? "bg-slate-100" : "bg-blue-500")} />
                            <div className="flex items-center justify-between gap-4">
                              {log.isPending ? (
                                <div className={cn("flex items-center gap-2 animate-pulse", log.speaker === "Person A" ? "text-blue-600" : "text-blue-100")}>
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                  <span className="text-xs font-bold">Translating...</span>
                                </div>
                              ) : (
                                <>
                                  <p className={cn("text-sm font-bold italic", log.speaker === "Person A" ? "text-blue-600" : "text-blue-100")}>
                                    {log.translation}
                                  </p>
                                  <Button 
                                    variant="ghost" 
                                    size="icon" 
                                    onClick={() => speakText(log.translation, log.lang)}
                                    className={cn("h-6 w-6 rounded-full", log.speaker === "Person A" ? "hover:bg-blue-50 text-blue-600" : "hover:bg-blue-700 text-white")}
                                  >
                                    <Volume2 className="w-3 h-3" />
                                  </Button>
                                </>
                              )}
                            </div>
                          </div>
                        </motion.div>
                      ))
                    )}
                    
                    {isListening && currentTranscript && (
                      <motion.div 
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className={cn(
                          "flex flex-col max-w-[85%] space-y-1",
                          activeSpeaker === "A" ? "mr-auto" : "ml-auto items-end"
                        )}
                      >
                        <span className="text-[10px] font-bold text-blue-500 uppercase tracking-widest px-1 animate-pulse">
                          {activeSpeaker === "A" ? "Person A" : "Person B"} is speaking...
                        </span>
                        <div className={cn(
                          "p-4 rounded-2xl shadow-md border-2",
                          activeSpeaker === "A" 
                            ? "bg-white border-blue-400 rounded-tl-none" 
                            : "bg-blue-50 border-blue-400 rounded-tr-none"
                        )}>
                          <p className="text-sm leading-relaxed font-bold text-slate-800">{currentTranscript}</p>
                        </div>
                      </motion.div>
                    )}
                    {isLoading && (
                      <div className="flex justify-center">
                        <Badge variant="secondary" className="animate-pulse bg-blue-50 text-blue-600 border-none px-4 py-1">
                          <Loader2 className="w-3 h-3 mr-2 animate-spin" /> Translating...
                        </Badge>
                      </div>
                    )}
                    <div ref={scrollRef} className="h-px" />
                  </div>
                </ScrollArea>
              </CardContent>
              <CardFooter className="bg-slate-50/50 border-t border-slate-100 p-4 sm:p-6 flex flex-row gap-3 sm:gap-4">
                <div className="flex-1 flex flex-col gap-2">
                  <Button 
                    onClick={() => toggleListening("A")}
                    disabled={isListening && activeSpeaker !== "A"}
                    className={cn(
                      "w-full h-20 sm:h-24 rounded-2xl flex flex-col items-center justify-center gap-1 sm:gap-2 transition-all duration-300 relative overflow-hidden",
                      activeSpeaker === "A" 
                        ? "bg-red-600 hover:bg-red-700 shadow-lg shadow-red-200 border-none text-white" 
                        : "bg-white text-slate-800 border-2 border-slate-100 hover:bg-slate-50 hover:border-slate-200"
                    )}
                  >
                    {activeSpeaker === "A" ? (
                      <>
                        <motion.div 
                          initial={{ scale: 0.8, opacity: 0 }}
                          animate={{ scale: 1.2, opacity: [0.1, 0.3, 0.1] }}
                          transition={{ duration: 2, repeat: Infinity }}
                          className="absolute inset-0 bg-white rounded-full"
                        />
                        <MicOff className="w-5 h-5 sm:w-6 sm:h-6 relative z-10" />
                        <div className="flex items-center gap-1 sm:gap-2 relative z-10">
                          <SoundWave active={true} color="bg-white" />
                          <span className="text-[9px] sm:text-[10px] font-black uppercase tracking-widest">Stop</span>
                        </div>
                      </>
                    ) : (
                      <>
                        <Mic className="w-5 h-5 sm:w-6 sm:h-6 text-blue-600" />
                        <div className="flex items-center gap-1 sm:gap-2">
                          <SoundWave active={false} />
                          <span className="text-[9px] sm:text-[10px] font-bold uppercase tracking-widest text-slate-400">Speak</span>
                        </div>
                      </>
                    )}
                  </Button>
                  <div className="flex items-center justify-between px-1">
                    <span className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">A</span>
                    <Badge variant="outline" className="text-[8px] font-bold border-slate-200 text-slate-400 rounded-full px-1.5">
                      {sourceLang}
                    </Badge>
                  </div>
                </div>
                
                <div className="flex-1 flex flex-col gap-2">
                  <Button 
                    onClick={() => toggleListening("B")}
                    disabled={isListening && activeSpeaker !== "B"}
                    className={cn(
                      "w-full h-20 sm:h-24 rounded-2xl flex flex-col items-center justify-center gap-1 sm:gap-2 transition-all duration-300 relative overflow-hidden",
                      activeSpeaker === "B" 
                        ? "bg-red-600 hover:bg-red-700 shadow-lg shadow-red-200 border-none text-white" 
                        : "bg-blue-600 text-white hover:bg-blue-700 shadow-md shadow-blue-100"
                    )}
                  >
                    {activeSpeaker === "B" ? (
                      <>
                        <motion.div 
                          initial={{ scale: 0.8, opacity: 0 }}
                          animate={{ scale: 1.2, opacity: [0.1, 0.3, 0.1] }}
                          transition={{ duration: 2, repeat: Infinity }}
                          className="absolute inset-0 bg-white rounded-full"
                        />
                        <MicOff className="w-5 h-5 sm:w-6 sm:h-6 relative z-10" />
                        <div className="flex items-center gap-1 sm:gap-2 relative z-10">
                          <SoundWave active={true} color="bg-white" />
                          <span className="text-[9px] sm:text-[10px] font-black uppercase tracking-widest">Stop</span>
                        </div>
                      </>
                    ) : (
                      <>
                        <Mic className="w-5 h-5 sm:w-6 sm:h-6" />
                        <div className="flex items-center gap-1 sm:gap-2">
                          <SoundWave active={false} color="bg-white/30" />
                          <span className="text-[9px] sm:text-[10px] font-bold uppercase tracking-widest opacity-70">Speak</span>
                        </div>
                      </>
                    )}
                  </Button>
                  <div className="flex items-center justify-between px-1">
                    <span className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">B</span>
                    <Badge variant="outline" className="text-[8px] font-bold border-slate-200 text-slate-400 rounded-full px-1.5">
                      {targetLang}
                    </Badge>
                  </div>
                </div>
              </CardFooter>
            </Card>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="mt-auto py-12 border-t border-slate-200 bg-white">
        <div className="max-w-7xl mx-auto px-4 flex flex-col md:flex-row justify-between items-center gap-8">
          <div className="space-y-3 text-center md:text-left">
            <div className="flex items-center justify-center md:justify-start gap-2">
              <div className="w-6 h-6 bg-blue-600 rounded-lg flex items-center justify-center">
                <Languages className="w-3 h-3 text-white" />
              </div>
              <span className="font-bold text-slate-800">LingoBridge</span>
            </div>
            <p className="text-xs text-slate-500 max-w-xs leading-relaxed">
              Empowering seamless communication across Indian languages with advanced AI-driven transcript translation.
            </p>
          </div>
          
          <div className="flex gap-16">
            <div className="space-y-4">
              <h4 className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Languages</h4>
              <ul className="text-xs space-y-2 text-slate-600 font-medium">
                <li>Hindi & Tamil</li>
                <li>Telugu & Kannada</li>
                <li>Bengali & Marathi</li>
              </ul>
            </div>
            <div className="space-y-4">
              <h4 className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Technology</h4>
              <ul className="text-xs space-y-2 text-slate-600 font-medium">
                <li>Gemini 2.0 Flash</li>
                <li>Web Speech API</li>
                <li>React 19.0</li>
              </ul>
            </div>
          </div>
        </div>
        <div className="max-w-7xl mx-auto px-4 mt-12 pt-8 border-t border-slate-100 text-center">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-300">
            &copy; {new Date().getFullYear()} LingoBridge // Linguistic Intelligence
          </p>
        </div>
      </footer>
    </div>
  );
}
