import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet
} from 'react-native';
import { AIState, SystemContext, Message } from '../../types';
import { aiService } from '../../services/aiService';
import MarkdownText from '../../components/MarkdownText';

interface AIAssistantProps {
  aiState: AIState;
  onUpdateAI: (updates: Partial<AIState>) => void;
  systemContext: SystemContext;
  appActions: {
    addApp: (appKey: import('../../types').AppState['currentMobileApp']) => void;
    removeApp: (appKey: import('../../types').AppState['currentMobileApp']) => void;
    // Custom app actions use the shared apps/{shareCode} collection
    createCustomApp: (app: any) => Promise<string | null>;
    updateCustomApp: (appId: string, updates: any) => Promise<boolean>;
    deleteCustomApp: (appId: string) => Promise<boolean>;
    // Instance-based state updates for Spaces architecture
    updateAppInstance?: (instanceId: string, updates: any) => void;
    // Event links management
    updateEventLinks?: (links: import('../../types').EventLink[]) => void;
    // Space management for custom apps
    addAppToSpace?: (spaceId: string, appId: string, appType: string) => void;
  };
}

export default function AIAssistant({ aiState, onUpdateAI, systemContext, appActions }: AIAssistantProps) {
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const scrollViewRef = useRef<ScrollView>(null);

  // NOTE: app-action registration and event-listener/dynamic-event-link wiring
  // now live at the always-mounted layout level (WebDashboard), not here — so
  // cross-app events fire whether or not this tile is on a Space. This component
  // only reads from aiService (chat). Don't re-add registration here, or it will
  // double-register over the shared unsubscriber array.

  // Ensure aiState has conversations
  const conversations = aiState?.conversations || [];

  // Initialize conversation on mount if needed
  useEffect(() => {
    if (conversations.length === 0) {
      const newConversation = {
        id: 'default',
        title: 'AI Chat',
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        lastActivity: Date.now()
      };

      onUpdateAI({
        conversations: [newConversation],
        activeConversation: 'default'
      });
    }
  }, [conversations.length, onUpdateAI]);

  // Get active conversation without state updates
  const getActiveConversation = () => {
    if (conversations.length === 0) {
      return {
        id: 'default',
        title: 'AI Chat',
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        lastActivity: Date.now()
      };
    }

    const activeId = aiState?.activeConversation || conversations[0]?.id;
    return conversations.find(c => c.id === activeId) || conversations[0];
  };

  const activeConversation = getActiveConversation();
  const messages = activeConversation?.messages || [];

  // Auto-scroll to bottom when messages change or loading state changes
  useEffect(() => {
    // Use setTimeout to ensure scroll happens after content renders
    const timer = setTimeout(() => {
      scrollViewRef.current?.scrollToEnd({ animated: true });
    }, 100);
    return () => clearTimeout(timer);
  }, [messages, isLoading]);

  const handleKeyPress = (e: any) => {
    // Handle both React Native web (nativeEvent.key) and DOM events (key)
    const key = e.nativeEvent?.key || e.key;
    const shiftKey = e.nativeEvent?.shiftKey || e.shiftKey;

    if (key === 'Enter' && !shiftKey) {
      e.preventDefault?.();
      sendMessage();
    }
  };

  const sendMessage = async () => {
    if (!inputText.trim() || isLoading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: inputText.trim(),
      timestamp: Date.now(),
      appContext: systemContext?.currentApp
    };

    // Add user message immediately
    const updatedMessages = [...messages, userMessage];
    updateConversation(updatedMessages);
    setInputText('');
    setIsLoading(true);

    try {
      // Build conversation history for context (exclude the message we just added)
      const conversationHistory = messages.map(msg => ({
        role: msg.role as 'user' | 'assistant' | 'system',
        content: msg.content
      }));

      // Get AI response with function calling support, including conversation history
      const response = await aiService.chatWithFunctions(userMessage.content, systemContext, conversationHistory);

      let aiMessageContent = response.message;

      // If function was called, append function call info
      if (response.functionCall) {
        const functionInfo = `\n\n🔧 **Action:** ${response.functionCall.name}\n💾 **Result:** ${response.functionCall.result.message}`;
        aiMessageContent += functionInfo;
      }

      const aiMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: aiMessageContent,
        timestamp: Date.now(),
        appContext: systemContext?.currentApp
      };

      // If a function was called that modifies state, wait longer for the write-through to land
      const syncDelay = response.functionCall ? 500 : 0;

      if (syncDelay > 0) {
        setTimeout(() => {
          updateConversation([...updatedMessages, aiMessage]);
          setIsLoading(false);
        }, syncDelay);
      } else {
        updateConversation([...updatedMessages, aiMessage]);
        setIsLoading(false);
      }

    } catch (error) {
      console.error('Failed to get AI response:', error);
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'system',
        content: 'Sorry, I encountered an error. Please try again.',
        timestamp: Date.now()
      };
      updateConversation([...updatedMessages, errorMessage]);
      setIsLoading(false);
    }
  };

  const updateConversation = (newMessages: Message[]) => {
    const updatedConversation = {
      ...activeConversation,
      messages: newMessages,
      updatedAt: Date.now(),
      lastActivity: Date.now()
    };

    const updatedConversations = conversations.map(c =>
      c.id === activeConversation.id ? updatedConversation : c
    );

    onUpdateAI({
      conversations: updatedConversations
    });
  };

  const clearChat = () => {
    const clearedConversation = {
      ...activeConversation,
      messages: [],
      updatedAt: Date.now(),
      lastActivity: Date.now()
    };

    const updatedConversations = conversations.map(c =>
      c.id === activeConversation.id ? clearedConversation : c
    );

    onUpdateAI({
      conversations: updatedConversations
    });
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <View style={styles.headerTextContainer}>
            <Text style={styles.headerTitle}>► AI ASSISTANT</Text>
            <Text style={styles.headerSubtitle}>
              Chat interface with cross-app integration
            </Text>
          </View>
          {messages.length > 0 && (
            <TouchableOpacity
              style={styles.clearButton}
              onPress={clearChat}
            >
              <Text style={styles.clearButtonText}>CLEAR</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Messages */}
      <ScrollView
        ref={scrollViewRef}
        style={styles.messagesContainer}
        contentContainerStyle={styles.messagesContent}
        showsVerticalScrollIndicator={true}
        keyboardShouldPersistTaps="handled"
      >
        {messages.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>► Start a conversation</Text>
            <Text style={styles.emptySubtext}>
              I can help you manage todos, track workouts, create custom apps, and more.
            </Text>
            <Text style={styles.exampleText}>Try:</Text>
            <Text style={styles.exampleText}>• "Add todo: buy groceries"</Text>
            <Text style={styles.exampleText}>• "Create a countdown timer app"</Text>
            <Text style={styles.exampleText}>• "Summarize my workouts"</Text>
            <Text style={styles.exampleText}>• "Add a pomodoro timer to my dashboard"</Text>
          </View>
        ) : (
          messages.map((message, index) => (
            <View key={message.id} style={[
              styles.message,
              message.role === 'user' ? styles.userMessage : styles.aiMessage
            ]}>
              <Text style={styles.messageRole}>
                {message.role === 'user' ? 'USER' : 'AI'}
              </Text>
              <MarkdownText style={styles.messageContent}>
                {message.content}
              </MarkdownText>
              <Text style={styles.messageTime}>
                {new Date(message.timestamp).toLocaleTimeString()}
              </Text>
            </View>
          ))
        )}

        {isLoading && (
          <View style={styles.loadingMessage}>
            <Text style={styles.messageRole}>AI</Text>
            <Text style={styles.loadingText}>Thinking...</Text>
          </View>
        )}
      </ScrollView>

      {/* Input */}
      <View style={styles.inputContainer}>
        <TextInput
          style={styles.textInput}
          value={inputText}
          onChangeText={setInputText}
          placeholder="Type your message... (Enter to send, Shift+Enter for new line)"
          placeholderTextColor="#004444"
          multiline
          maxLength={500}
          onSubmitEditing={sendMessage}
          onKeyPress={handleKeyPress}
          blurOnSubmit={false}
        />
        <TouchableOpacity
          style={[styles.sendButton, (!inputText.trim() || isLoading) && styles.disabledButton]}
          onPress={sendMessage}
          disabled={!inputText.trim() || isLoading}
        >
          <Text style={styles.sendButtonText}>SEND</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
    height: '100%',
    overflow: 'hidden',
  },
  header: {
    borderBottomWidth: 2,
    borderBottomColor: '#00ffff',
    backgroundColor: 'rgba(0, 20, 20, 0.8)',
    padding: 20,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerTextContainer: {
    flex: 1,
  },
  headerTitle: {
    fontFamily: 'Courier New',
    fontSize: 16,
    letterSpacing: 2,
    color: '#00ffff',
    fontWeight: 'bold',
    marginBottom: 5,
  },
  headerSubtitle: {
    fontFamily: 'Courier New',
    fontSize: 11,
    color: '#00cccc',
  },
  clearButton: {
    borderWidth: 1,
    borderColor: '#ff0000',
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginLeft: 10,
  },
  clearButtonText: {
    fontFamily: 'Courier New',
    fontSize: 10,
    color: '#ff0000',
    fontWeight: 'bold',
  },
  messagesContainer: {
    flex: 1,
    minHeight: 0,
  },
  messagesContent: {
    padding: 20,
    paddingBottom: 20,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyText: {
    fontFamily: 'Courier New',
    fontSize: 14,
    color: '#00ffff',
    marginBottom: 10,
  },
  emptySubtext: {
    fontFamily: 'Courier New',
    fontSize: 11,
    color: '#006666',
    textAlign: 'center',
    marginBottom: 20,
  },
  exampleText: {
    fontFamily: 'Courier New',
    fontSize: 10,
    color: '#004444',
    textAlign: 'center',
    fontStyle: 'italic',
  },
  message: {
    marginBottom: 20,
    maxWidth: '85%',
  },
  userMessage: {
    alignSelf: 'flex-end',
    backgroundColor: 'rgba(0, 255, 255, 0.1)',
    borderWidth: 1,
    borderColor: '#00ffff',
    padding: 12,
  },
  aiMessage: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(0, 255, 0, 0.1)',
    borderWidth: 1,
    borderColor: '#00ff00',
    padding: 12,
  },
  messageRole: {
    fontFamily: 'Courier New',
    fontSize: 10,
    fontWeight: 'bold',
    marginBottom: 8,
    color: '#00ffff',
  },
  messageContent: {
    fontFamily: 'Courier New',
    fontSize: 12,
    color: '#ffffff',
    lineHeight: 18,
    marginBottom: 8,
  },
  messageTime: {
    fontFamily: 'Courier New',
    fontSize: 9,
    color: '#666666',
  },
  loadingMessage: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255, 255, 0, 0.1)',
    borderWidth: 1,
    borderColor: '#ffff00',
    padding: 12,
    marginBottom: 20,
    maxWidth: '85%',
  },
  loadingText: {
    fontFamily: 'Courier New',
    fontSize: 12,
    color: '#ffff00',
    fontStyle: 'italic',
  },
  inputContainer: {
    flexDirection: 'row',
    padding: 20,
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: '#004444',
    backgroundColor: 'rgba(0, 10, 10, 0.8)',
    flexShrink: 0,
  },
  textInput: {
    flex: 1,
    backgroundColor: '#000000',
    borderWidth: 1,
    borderColor: '#00ffff',
    color: '#00ffff',
    padding: 12,
    fontFamily: 'Courier New',
    fontSize: 13,
    minHeight: 44,
    maxHeight: 100,
    textAlignVertical: 'top',
  },
  sendButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#00ff00',
    paddingHorizontal: 20,
    paddingVertical: 12,
    justifyContent: 'center',
  },
  sendButtonText: {
    fontFamily: 'Courier New',
    fontSize: 12,
    color: '#00ff00',
    fontWeight: 'bold',
  },
  disabledButton: {
    borderColor: '#333333',
  },
});