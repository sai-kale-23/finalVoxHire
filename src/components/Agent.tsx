import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Mic, MicOff, Phone, PhoneOff, Send, Volume2, Video, VideoOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";

interface AgentProps {
  userName?: string;
  type?: "generate" | "interview";
  interviewId?: string;
  role?: string;
  interviewType?: string;
  techStack?: string[];
  questions?: string[];
  onComplete?: (transcript: string) => void;
}

interface Message {
  role: "user" | "assistant";
  content: string;
}

// Speech Recognition types
declare global {
  interface Window {
    webkitSpeechRecognition: any;
    SpeechRecognition: any;
  }
}

const Agent = ({ 
  userName = "User", 
  type = "interview",
  interviewId,
  role = "Developer",
  interviewType = "technical",
  techStack = [],
  questions = [],
  onComplete
}: AgentProps) => {
  const [isCallActive, setIsCallActive] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isCameraOn, setIsCameraOn] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [transcript, setTranscript] = useState<string[]>([]);
  const [askedQuestions, setAskedQuestions] = useState<Set<number>>(new Set());
  const [askedQuestionTexts, setAskedQuestionTexts] = useState<Set<string>>(new Set());
  const [hasDoneWarmup, setHasDoneWarmup] = useState(false);
  const [hasGreeted, setHasGreeted] = useState(false);
  
  const navigate = useNavigate();
  const { toast } = useToast();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);
  const pendingSpeechRef = useRef<string>("");
  const speechSynthesisRef = useRef<SpeechSynthesisUtterance | null>(null);
  const streamChatRef = useRef<((message: string) => Promise<void>) | null>(null);
  const isCallActiveRef = useRef(isCallActive);
  const isMutedRef = useRef(isMuted);
  const isSpeakingRef = useRef(isSpeaking);
  const isProcessingRef = useRef(isProcessing);
  const askedQuestionsRef = useRef<Set<number>>(new Set());
  const askedQuestionTextsRef = useRef<Set<string>>(new Set());
  const hasGreetedRef = useRef(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const systemPrompt = `You are an expert AI interviewer conducting a mock ${interviewType} interview for a ${role} position.

${techStack.length > 0 ? `The candidate should be familiar with: ${techStack.join(', ')}` : ''}

Your behavior:
- Be professional, friendly, and encouraging
- Ask one question at a time and wait for the candidate's response
- Provide brief acknowledgments (1-2 sentences) before moving to the next question
- If the candidate seems stuck, offer gentle prompts
- Keep responses concise for natural conversation flow
- The interview will automatically end after 7 questions and feedback will be provided

${questions.length > 0 ? `Interview questions to ask (in order, ask each only once):
${questions.map((q, i) => `${i + 1}. ${q}`).join('\n')}` : ''}

Current question number: ${currentQuestionIndex + 1} of 7 (maximum)

Start by greeting the candidate named ${userName}, briefly introduce yourself as their AI interviewer, and ask the first question.`;

  // Keep refs in sync with state
  useEffect(() => {
    isCallActiveRef.current = isCallActive;
  }, [isCallActive]);
  
  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);
  
  useEffect(() => {
    isSpeakingRef.current = isSpeaking;
  }, [isSpeaking]);
  
  useEffect(() => {
    isProcessingRef.current = isProcessing;
  }, [isProcessing]);

  // Keep askedQuestionsRef in sync with state
  useEffect(() => {
    askedQuestionsRef.current = askedQuestions;
  }, [askedQuestions]);

  // Keep askedQuestionTextsRef in sync with state
  useEffect(() => {
    askedQuestionTextsRef.current = askedQuestionTexts;
  }, [askedQuestionTexts]);

  // Keep hasGreetedRef in sync with state
  useEffect(() => {
    hasGreetedRef.current = hasGreeted;
  }, [hasGreeted]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Initialize speech recognition (only once)
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.warn('Speech recognition not supported in this browser');
      return;
    }

    // Don't recreate if already exists
    if (recognitionRef.current) return;

    const recognition = new SpeechRecognition();
    // Use continuous recognition so short pauses don't cut the user off
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onstart = () => {
      setIsListening(true);
      console.log('Speech recognition started');
    };

    recognition.onend = () => {
      setIsListening(false);
      console.log('Speech recognition ended');

      const fullSpeech = pendingSpeechRef.current.trim();

      // If we have buffered speech, send it as a single complete message
      if (fullSpeech && streamChatRef.current && isCallActiveRef.current) {
        pendingSpeechRef.current = "";
        try {
          // Let the AI process the full answer; it will restart listening when ready
          streamChatRef.current(fullSpeech);
        } catch (e) {
          console.error('Error sending buffered speech to AI:', e);
        }
        return;
      }

      // No buffered speech – just restart listening if call is still active
      if (isCallActiveRef.current && !isMutedRef.current && !isSpeakingRef.current && !isProcessingRef.current) {
        setTimeout(() => {
          if (isCallActiveRef.current && !isMutedRef.current && !isSpeakingRef.current && recognitionRef.current) {
            try {
              recognitionRef.current.start();
            } catch (e: any) {
              console.log('Recognition start error (expected if already running):', e.message);
            }
          }
        }, 500);
      }
    };

    recognition.onerror = (event: any) => {
      console.error('Speech recognition error:', event.error);
      setIsListening(false);
      
      if (event.error === 'no-speech') {
        // Restart listening if no speech detected
        if (isCallActiveRef.current && !isMutedRef.current && !isSpeakingRef.current && recognitionRef.current) {
          setTimeout(() => {
            if (isCallActiveRef.current && !isMutedRef.current && !isSpeakingRef.current) {
              try {
                recognitionRef.current.start();
              } catch (e: any) {
                console.log('Recognition start error:', e.message);
              }
            }
          }, 1000);
        }
      } else if (event.error === 'not-allowed') {
        toast({
          variant: "destructive",
          title: "Microphone Permission",
          description: "Please allow microphone access to use voice input.",
        });
      }
    };

    recognition.onresult = (event: any) => {
      // Accumulate only final results into a buffer so short pauses don't cut the user off,
      // then send the full buffered text as a single message.
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          const chunk = result[0].transcript;
          console.log('Speech recognized (final chunk):', chunk);
          pendingSpeechRef.current = `${pendingSpeechRef.current} ${chunk}`.trim();
        }
      }

      const fullSpeech = pendingSpeechRef.current.trim();
      if (fullSpeech && streamChatRef.current && isCallActiveRef.current) {
        // Clear the buffer so onend doesn't resend it
        pendingSpeechRef.current = "";
        try {
          // Stop listening while we process this full answer
          if (recognitionRef.current) {
            recognitionRef.current.stop();
          }
          setIsListening(false);
        } catch (e) {
          console.log('Error stopping recognition after result:', e);
        }

        // Fire-and-forget; streamChat will restart listening when ready
        streamChatRef.current(fullSpeech);
      }
    };

    recognitionRef.current = recognition;

    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch (e) {
          // Ignore errors
        }
        recognitionRef.current = null;
      }
    };
  }, [toast]);

  // Cleanup speech synthesis on unmount
  useEffect(() => {
    return () => {
      if (speechSynthesisRef.current) {
        window.speechSynthesis.cancel();
      }
      // Cleanup camera stream
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }
    };
  }, []);

  // Start/stop camera based on isCameraOn state
  useEffect(() => {
    const startCamera = async () => {
      // Check if we already have a stream
      if (streamRef.current) {
        return;
      }

      try {
        // Check if getUserMedia is available
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          throw new Error('Camera access is not supported in this browser');
        }

        const stream = await navigator.mediaDevices.getUserMedia({
          video: { 
            facingMode: 'user', 
            width: { ideal: 1280 }, 
            height: { ideal: 720 } 
          },
          audio: false // We're using speech recognition for audio
        });
        
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(err => {
            console.error('Error playing video:', err);
          });
        }
      } catch (error: any) {
        console.error('Error accessing camera:', error);
        // Reset state on error
        setIsCameraOn(false);
        if (streamRef.current) {
          streamRef.current.getTracks().forEach(track => track.stop());
          streamRef.current = null;
        }
        toast({
          variant: "destructive",
          title: "Camera Access Denied",
          description: error.message || "Please allow camera access to use video during the interview.",
        });
      }
    };

    const stopCamera = () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => {
          track.stop();
        });
        streamRef.current = null;
      }
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
    };

    // Only start camera if both conditions are met
    if (isCallActive && isCameraOn) {
      startCamera();
    } else {
      // Only stop if we have an active stream
      if (streamRef.current) {
        stopCamera();
      }
    }

    // Cleanup on unmount
    return () => {
      stopCamera();
    };
  }, [isCallActive, isCameraOn, toast]);

  // Helper function to select best natural voice
  const selectNaturalVoice = useCallback((voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null => {
    if (voices.length === 0) return null;
    
    // Prefer natural-sounding voices (common names for natural/premium voices)
    const preferredVoices = voices.filter(voice => 
      voice.lang.startsWith('en') && (
        voice.name.toLowerCase().includes('natural') ||
        voice.name.toLowerCase().includes('premium') ||
        voice.name.toLowerCase().includes('neural') ||
        voice.name.toLowerCase().includes('enhanced') ||
        voice.name.toLowerCase().includes('samantha') ||
        voice.name.toLowerCase().includes('alex') ||
        voice.name.toLowerCase().includes('daniel') ||
        voice.name.toLowerCase().includes('google us english') ||
        voice.name.toLowerCase().includes('google uk english')
      )
    );
    
    if (preferredVoices.length > 0) {
      return preferredVoices[0];
    }
    
    // Fallback to any English voice
    const englishVoices = voices.filter(voice => voice.lang.startsWith('en'));
    return englishVoices.length > 0 ? englishVoices[0] : null;
  }, []);

  // Text-to-speech function with natural, conversational voice
  const speakText = useCallback((text: string): Promise<void> => {
    return new Promise((resolve) => {
      if (!('speechSynthesis' in window)) {
        console.warn('Speech synthesis not supported');
        resolve();
        return;
      }

      // Cancel any ongoing speech
      window.speechSynthesis.cancel();

      const utterance = new SpeechSynthesisUtterance(text);
      
      // More natural, conversational settings (less formal)
      utterance.rate = 1.1; // Slightly faster = more natural and conversational
      utterance.pitch = 0.95; // Slightly lower pitch = more natural, less robotic
      utterance.volume = 1.0;
      utterance.lang = 'en-US';

      // Try to select a more natural voice
      const voices = window.speechSynthesis.getVoices();
      const selectedVoice = selectNaturalVoice(voices);
      if (selectedVoice) {
        utterance.voice = selectedVoice;
      }

      // If voices aren't loaded yet, wait for them
      if (voices.length === 0) {
        const onVoicesChanged = () => {
          const updatedVoices = window.speechSynthesis.getVoices();
          const selectedVoice = selectNaturalVoice(updatedVoices);
          if (selectedVoice) {
            utterance.voice = selectedVoice;
          }
          window.speechSynthesis.speak(utterance);
          window.speechSynthesis.onvoiceschanged = null;
        };
        window.speechSynthesis.onvoiceschanged = onVoicesChanged;
        // Also try to get voices immediately in case they're available now
        const immediateVoices = window.speechSynthesis.getVoices();
        if (immediateVoices.length > 0) {
          window.speechSynthesis.onvoiceschanged = null;
          const selectedVoice = selectNaturalVoice(immediateVoices);
          if (selectedVoice) {
            utterance.voice = selectedVoice;
          }
          window.speechSynthesis.speak(utterance);
        }
      } else {
        window.speechSynthesis.speak(utterance);
      }

      utterance.onstart = () => {
        setIsSpeaking(true);
      };

      utterance.onend = () => {
        setIsSpeaking(false);
        speechSynthesisRef.current = null;
        resolve();
      };

      utterance.onerror = (event) => {
        console.error('Speech synthesis error:', event);
        setIsSpeaking(false);
        speechSynthesisRef.current = null;
        resolve();
      };

      speechSynthesisRef.current = utterance;
    });
  }, [selectNaturalVoice]);

  const streamChat = async (userMessage: string) => {
    // 🔴 AUTO-END INTERVIEW AFTER 7 QUESTIONS
    // If we've asked 7 questions (currentQuestionIndex >= 7), end interview immediately
    // Check state directly instead of ref to avoid timing issues
    if (currentQuestionIndex >= 7) {
      setIsCallActive(false);
      setIsSpeaking(false);
      setIsListening(false);
      setIsProcessing(false);

      // Stop recognition completely
      if (recognitionRef.current) {
        try {
          recognitionRef.current.onend = null;
          recognitionRef.current.onerror = null;
          recognitionRef.current.stop();
        } catch {}
      }

      // Stop speech
      window.speechSynthesis.cancel();

      // Include the current user message in transcript before ending
      const finalTranscript = [...transcript, `${userName}: ${userMessage}`].join("\n\n");

      if (onComplete) {
        onComplete(finalTranscript);
      } else if (interviewId) {
        navigate(`/interview/${interviewId}`);
      }

      return; // ⛔ ABSOLUTE STOP
    }
    
    // Check if call is active - use a function to get current state
    if (!isCallActive) {
      return; // Don't process if call is not active
    }

    setIsProcessing(true);

    console.log(`Processing user message. Current question index: ${currentQuestionIndex}, Questions length: ${questions.length}`);

    let newMessages: Message[] = [];
    setMessages(prev => {
      newMessages = [...prev, { role: "user" as const, content: userMessage }];
      return newMessages;
    });
    setTranscript(prev => [...prev, `${userName}: ${userMessage}`]);
    
    // 🔴 PREVENT AI CALL IF QUESTIONS ARE OVER
    // Allow asking up to question 7 (currentQuestionIndex can be 0-6)
    // Only block if we've already asked 7 questions (currentQuestionIndex >= 7)
    if (currentQuestionIndex >= 7) {
      setIsProcessing(false);
      return; // ⛔ STOP further AI calls if we've asked 7 questions
    }

    try {
      // Use ref to get the latest asked questions (avoids stale state)
      const askedQuestionsList = Array.from(askedQuestionsRef.current).sort((a, b) => a - b);
      const askedTextsList = Array.from(askedQuestionTextsRef.current);
      
      // Also include the current question index if we're in formal phase to prevent immediate repeats
      const allAskedIndices = hasDoneWarmup && currentQuestionIndex < 7
        ? [...askedQuestionsList, currentQuestionIndex]
        : askedQuestionsList;
      const uniqueAskedIndices = Array.from(new Set(allAskedIndices)).sort((a, b) => a - b);
      
      // Build comprehensive list of asked questions with their text
      const askedQuestionsWithText = uniqueAskedIndices.map(i => {
        const questionText = questions[i] || `Question ${i + 1}`;
        return `${i + 1}. "${questionText}"`;
      }).join('\n');
      
      const askedQuestionsText = uniqueAskedIndices.length > 0 
        ? `ALREADY ASKED QUESTIONS (ABSOLUTELY DO NOT REPEAT ANY OF THESE - THIS IS CRITICAL):
${askedQuestionsWithText}
${askedTextsList.length > 0 ? `\nAlso already asked (by text):\n${Array.from(askedTextsList).map((q, idx) => `- "${q}"`).join('\n')}` : ''}

⚠️ CRITICAL WARNING: 
- You MUST NOT repeat ANY question from the list above, even if rephrased
- You MUST NOT ask variations or follow-ups of questions above
- You MUST ask a COMPLETELY NEW question that is NOT in the list above
- If you repeat a question, the interview will be invalid`
        : 'No questions asked yet.';

      const systemPromptValue = `You are an expert AI interviewer conducting a mock ${interviewType} interview for a ${role} position.

${techStack.length > 0 ? `The candidate should be familiar with: ${techStack.join(', ')}` : ''}

Your behavior:
- Be professional, friendly, and encouraging
- Ask one question at a time and wait for the candidate's response
- Provide brief acknowledgments (1-2 sentences) before moving to the next question
- If the candidate seems stuck, offer gentle prompts
- Keep responses concise for natural conversation flow
- When all questions are asked, thank the candidate and let them know feedback will be ready shortly
- ⚠️ CRITICAL: ${hasGreetedRef.current ? 'You have ALREADY greeted the candidate. DO NOT say "hello", "hi", "hey", "welcome", "greetings", or any greeting words again. Just proceed directly with the question or acknowledgment.' : 'You may greet the candidate ONCE at the very start, but after that initial greeting, NEVER use greeting words again.'}

${questions.length > 0 ? `Interview questions available (in order):
${questions.map((q, i) => `${i + 1}. ${q}`).join('\n')}` : ''}

${askedQuestionsText}

CRITICAL INSTRUCTIONS (STRICT - FOLLOW EXACTLY):
${!hasDoneWarmup
  ? `- You are currently in the warm-up phase. For this response:
   • Greet the candidate by their name: "${userName}"
   • Ask 1–2 short questions ONLY about their technical background (years of experience, main technologies, most recent role)
   • DO NOT start any of the numbered technical/behavioral interview questions yet
   • End your message after the background questions and WAIT for the candidate's spoken response before asking any formal interview question
   • This warm-up happens ONLY ONCE, before the very first interview question. Do not repeat background questions later in the interview.`
  : `- You are now in the formal interview phase.
- Current question number to ask: ${currentQuestionIndex + 1} of 7 maximum
${questions.length > 0 && questions[currentQuestionIndex]
    ? `- Ask ONLY question #${currentQuestionIndex + 1} from the list above: "${questions[currentQuestionIndex]}"`
    : '- Generate an appropriate interview question based on the role and tech stack'}
- Do NOT ask any more warm-up or background questions in this phase; focus only on the numbered interview questions
- Ask each formal interview question EXACTLY as written, word for word (if a specific question is provided)
- ⚠️ CRITICAL: NEVER repeat any question from the "Already asked questions" list above - this is a hard requirement
- ⚠️ CRITICAL: NEVER ask follow-up questions or variations of previous questions
- ⚠️ CRITICAL: You MUST ask a DIFFERENT question than any in the "Already asked questions" list
- If this is question 7, after the candidate responds, conclude the interview immediately
- After asking each question, WAIT for the candidate's response before speaking again
- If you are unsure which question to ask, check the "Already asked questions" list and pick the NEXT question in sequence that has NOT been asked yet`}`;

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-chat`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
          body: JSON.stringify({ 
            messages: newMessages.map(m => ({ role: m.role, content: m.content })),
            systemPrompt: systemPromptValue
          }),
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to get response");
      }

      if (!response.body) throw new Error("No response body");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let assistantMessage = "";
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        let newlineIndex;
        while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
          let line = buffer.slice(0, newlineIndex);
          buffer = buffer.slice(newlineIndex + 1);

          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (line.startsWith(":") || line.trim() === "") continue;
          if (!line.startsWith("data: ")) continue;

          const jsonStr = line.slice(6).trim();
          if (jsonStr === "[DONE]") break;

              try {
                const parsed = JSON.parse(jsonStr);
                const content = parsed.choices?.[0]?.delta?.content;
                if (content) {
                  assistantMessage += content;
                  setMessages(prev => {
                    // If last message is assistant, replace it; otherwise append
                    const lastMsg = prev[prev.length - 1];
                    if (lastMsg?.role === "assistant") {
                      return [...prev.slice(0, -1), { role: "assistant", content: assistantMessage }];
                    }
                    return [...prev, { role: "assistant", content: assistantMessage }];
                  });
                }
              } catch {
            buffer = line + "\n" + buffer;
            break;
          }
        }
      }

      setTranscript(prev => [...prev, `AI Interviewer: ${assistantMessage}`]);

      // Check if this message contains a greeting (mark as greeted)
      const greetingWords = ['hello', 'hi', 'hey', 'welcome', 'greetings', 'good morning', 'good afternoon', 'good evening'];
      const messageLower = assistantMessage.toLowerCase();
      const containsGreeting = greetingWords.some(word => messageLower.includes(word));
      if (containsGreeting && !hasGreeted) {
        setHasGreeted(true);
        hasGreetedRef.current = true;
      }

      // Extract and track the actual question text from the assistant's message
      // Look for question marks or sentences that seem like questions
      const questionMatch = assistantMessage.match(/[^.!?]*\?/g);
      if (questionMatch && questionMatch.length > 0) {
        // Take the last question in the message (usually the main one)
        const questionText = questionMatch[questionMatch.length - 1].trim();
        if (questionText.length > 10) { // Only track substantial questions
          askedQuestionTextsRef.current.add(questionText);
          setAskedQuestionTexts(prev => new Set([...prev, questionText]));
        }
      }

      // If we haven't done the warm-up yet, treat this entire response as warm-up only
      if (!hasDoneWarmup) {
        setHasDoneWarmup(true);
        // Do NOT increment question index or mark any question as asked yet
      } else {
        // Mark current question as asked (track all questions up to 7, even if not in predefined array)
        if (currentQuestionIndex < 7) {
          // Update both state and ref immediately to prevent repeats
          askedQuestionsRef.current.add(currentQuestionIndex);
          setAskedQuestions(prev => {
            const updated = new Set([...prev, currentQuestionIndex]);
            console.log(
              `Question ${currentQuestionIndex + 1} asked. Asked questions:`,
              Array.from(updated)
            );
            return updated;
          });
        }
      }
      
      // Speak the AI response
      if (assistantMessage.trim()) {
        await speakText(assistantMessage);
      }
      
      // Move to next question only after formal questions start
      let nextIndex = currentQuestionIndex;
      if (hasDoneWarmup) {
        nextIndex = currentQuestionIndex + 1;
        setCurrentQuestionIndex(nextIndex);
      }
      
      // 🔴 AUTO-END INTERVIEW AFTER 7 QUESTIONS
      // If we just asked the 7th question (nextIndex = 7 means we've asked 7 questions)
      // After the user responds to question 7, the interview will end
      if (nextIndex >= 7) {
        // Don't restart listening - interview is complete after 7 questions
        // The interview will end when user responds (handled at start of streamChat)
        return;
      }

      // Restart listening after AI finishes speaking - use a ref to check state
      setTimeout(() => {
        if (recognitionRef.current) {
          try {
            recognitionRef.current.start();
          } catch (e) {
            // Already started or error - will be handled by onend/onerror
          }
        }
      }, 500);

    } catch (error) {
      console.error("Chat error:", error);
      console.error("Current question index:", currentQuestionIndex);
      console.error("Questions length:", questions.length);
      toast({
        variant: "destructive",
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to get AI response",
      });
      // Don't increment on error - allow retry
    } finally {
      setIsProcessing(false);
    }
  };

  // Update the ref when component mounts/updates
  useEffect(() => {
    streamChatRef.current = streamChat;
  });

  const handleCall = async () => {
    if (isCallActive) {
      // End call - generate feedback
      setIsCallActive(false);
      setIsSpeaking(false);
      setIsListening(false);
      
      // Stop speech recognition
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch (e) {
          // Ignore errors
        }
      }
      
      // Stop speech synthesis
      if (speechSynthesisRef.current) {
        window.speechSynthesis.cancel();
      }
      
      // Stop camera
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }
      setIsCameraOn(false);
      
      if (onComplete) {
        onComplete(transcript.join("\n\n"));
      } else if (interviewId) {
        // Navigate to feedback page
        navigate(`/interview/${interviewId}`);
      }
    } else {
      setIsCallActive(true);
      // Update ref synchronously to avoid timing issues
      isCallActiveRef.current = true;
      
      // Reset question tracking when starting a new interview
      setCurrentQuestionIndex(0);
      setAskedQuestions(new Set());
      askedQuestionsRef.current = new Set();
      setAskedQuestionTexts(new Set());
      askedQuestionTextsRef.current = new Set();
      setHasDoneWarmup(false);
      setHasGreeted(false);
      hasGreetedRef.current = false;
      
      // Check if speech recognition is available
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SpeechRecognition) {
        toast({
          variant: "destructive",
          title: "Voice not supported",
          description: "Your browser doesn't support speech recognition. You can still use text input.",
        });
      }
      
      // Send initial greeting (will trigger voice)
      await streamChat("Hello, I'm ready to begin the interview.");
      
      // Start listening after a short delay (after AI greeting)
      setTimeout(() => {
        if (recognitionRef.current && isCallActiveRef.current && !isMutedRef.current && !isSpeakingRef.current) {
          try {
            recognitionRef.current.start();
            console.log('Starting speech recognition after call start');
          } catch (e: any) {
            console.log('Recognition start error:', e.message);
          }
        }
      }, 3000);
    }
  };

  const handleSendMessage = async () => {
    if (!inputText.trim() || isProcessing) return;
    
    const message = inputText.trim();
    setInputText("");
    await streamChat(message);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const toggleMute = () => {
    const newMutedState = !isMuted;
    setIsMuted(newMutedState);
    isMutedRef.current = newMutedState;
    
    if (recognitionRef.current) {
      if (newMutedState) {
        // Stop listening when muted
        try {
          recognitionRef.current.stop();
          setIsListening(false);
        } catch (e) {
          // Ignore errors
        }
      } else if (isCallActiveRef.current && !isSpeakingRef.current && !isProcessingRef.current) {
        // Start listening when unmuted
        setTimeout(() => {
          if (recognitionRef.current && isCallActiveRef.current && !isMutedRef.current && !isSpeakingRef.current) {
            try {
              recognitionRef.current.start();
              console.log('Starting speech recognition after unmute');
            } catch (e: any) {
              console.log('Recognition start error:', e.message);
            }
          }
        }, 500);
      }
    }
  };

  const toggleCamera = async () => {
    if (!isCallActive) {
      toast({
        variant: "destructive",
        title: "Interview Not Started",
        description: "Please start the interview first before enabling the camera.",
      });
      return;
    }

    const newCameraState = !isCameraOn;
    setIsCameraOn(newCameraState);
    
    // If turning on, the useEffect will handle starting the camera
    // If turning off, stop immediately
    if (!newCameraState && streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
    }
  };

  return (
    <div className="flex flex-col gap-6 w-full animate-fade-in">
      {/* Agent Cards */}
      <div className="call-view">
        {/* AI Avatar Card */}
        <div className="card-interviewer">
          <div className="relative">
            {/* Pulsing animation when speaking */}
            {isSpeaking && isCallActive && (
              <div className="animate-speak" />
            )}
            
            {/* Avatar */}
            <div className={cn(
              "z-10 flex items-center justify-center blue-gradient rounded-full size-28 relative",
              isCallActive && "animate-pulse-glow"
            )}>
              <img
                src="/ai-avatar.svg"
                alt="AI Interviewer"
                className="size-16"
                onError={(e) => {
                  e.currentTarget.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23CAC5FE'%3E%3Cpath d='M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z'/%3E%3C/svg%3E";
                }}
              />
            </div>
          </div>

          <h3 className="text-center text-primary-100 mt-4 font-semibold">
            {isCallActive 
              ? (isSpeaking 
                  ? "AI is speaking..." 
                  : (isListening && !isMuted 
                      ? "Listening..." 
                      : (isMuted ? "Muted" : "Ready")))
              : "AI Interviewer"}
          </h3>

          {/* Call Controls */}
          <div className="flex items-center gap-4 mt-4">
            {isCallActive && (
              <>
                <button
                  onClick={toggleMute}
                  className={cn(
                    "p-3 rounded-full transition-all duration-200",
                    isMuted
                      ? "bg-destructive-100 hover:bg-destructive-200"
                      : "bg-dark-200 hover:bg-dark-300 border border-border"
                  )}
                >
                  {isMuted ? (
                    <MicOff className="size-5 text-white" />
                  ) : (
                    <Mic className="size-5 text-foreground" />
                  )}
                </button>
                <button
                  onClick={toggleCamera}
                  className={cn(
                    "p-3 rounded-full transition-all duration-200",
                    isCameraOn
                      ? "bg-dark-200 hover:bg-dark-300 border border-border"
                      : "bg-destructive-100 hover:bg-destructive-200"
                  )}
                >
                  {isCameraOn ? (
                    <Video className="size-5 text-foreground" />
                  ) : (
                    <VideoOff className="size-5 text-white" />
                  )}
                </button>
              </>
            )}

            <button
              onClick={handleCall}
              disabled={isProcessing}
              className={cn(
                "flex items-center gap-2 px-6 py-3 rounded-full font-bold transition-all duration-200",
                isCallActive
                  ? "btn-disconnect"
                  : "btn-call"
              )}
            >
              {isCallActive ? (
                <>
                  <PhoneOff className="size-5" />
                  <span>End Interview</span>
                </>
              ) : (
                <>
                  <Phone className="size-5" />
                  <span>Start Interview</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* User Card */}
        <div className="card-border flex-1 sm:basis-1/2 w-full h-[400px] max-md:hidden">
          <div className="card-content flex flex-col gap-4 justify-center items-center p-7 relative overflow-hidden">
            {isCameraOn && isCallActive ? (
              <>
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="absolute inset-0 w-full h-full object-cover rounded-lg"
                  style={{ transform: 'scaleX(-1)' }} // Mirror the video for natural feel
                />
                <div className="absolute inset-0 bg-gradient-to-t from-card/80 to-transparent" />
                <div className="relative z-10 flex flex-col items-center gap-2 mt-auto">
                  <h3 className="text-center text-foreground font-semibold drop-shadow-lg">{userName}</h3>
                  <p className="text-muted-foreground text-sm drop-shadow-lg">
                    {isMuted 
                      ? "Muted" 
                      : (isListening 
                          ? "Listening..." 
                          : "Connected")}
                  </p>
                  {isCallActive && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground drop-shadow-lg">
                      <Volume2 className="size-3" />
                      <span>Question {currentQuestionIndex + 1} of 7</span>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="size-28 rounded-full bg-gradient-to-br from-primary-200/20 to-accent/10 flex items-center justify-center border-2 border-primary-200/30">
                  <span className="text-4xl font-bold text-primary-200">
                    {userName.charAt(0).toUpperCase()}
                  </span>
                </div>
                <h3 className="text-center text-foreground font-semibold">{userName}</h3>
                <p className="text-muted-foreground text-sm">
                  {isCallActive 
                    ? (isMuted 
                        ? "Muted" 
                        : (isListening 
                            ? "Listening..." 
                            : "Connected")) 
                    : "Ready to connect"}
                </p>
                {isCallActive && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Volume2 className="size-3" />
                    <span>Question {currentQuestionIndex + 1} of 7</span>
                  </div>
                )}
                {isCallActive && !isCameraOn && (
                  <p className="text-xs text-muted-foreground mt-2 text-center">
                    Click the camera icon to enable video
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Chat Interface */}
      {isCallActive && (
        <div className="card-border w-full">
          <div className="card-content p-4">
            {/* Messages */}
            <div className="max-h-64 overflow-y-auto space-y-4 mb-4">
              {messages.map((message, index) => (
                <div
                  key={index}
                  className={cn(
                    "p-3 rounded-xl max-w-[80%]",
                    message.role === "user"
                      ? "ml-auto bg-primary-200/20 text-foreground"
                      : "mr-auto bg-dark-200 text-foreground"
                  )}
                >
                  <p className="text-xs text-muted-foreground mb-1">
                    {message.role === "user" ? userName : "AI Interviewer"}
                  </p>
                  <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="flex gap-2">
              <Input
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={handleKeyPress}
                placeholder="Type your response..."
                className="form-input flex-1"
                disabled={isProcessing}
              />
              <button
                onClick={handleSendMessage}
                disabled={!inputText.trim() || isProcessing}
                className="btn-primary px-4"
              >
                <Send className="size-4" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Agent;
