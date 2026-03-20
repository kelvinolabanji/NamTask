import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform, ActivityIndicator, Image,
} from 'react-native';
import { useLocalSearchParams, Stack, router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { tasksApi, ChatMessage } from '../../../src/services/api';
import { useAuthStore } from '../../../src/store/authStore';
import { useTaskRoom } from '../../../src/hooks/useSocket';
import { Avatar } from '../../../src/components/common';
import {
  Colors, FontSize, FontWeight, Spacing, Radius, Shadow,
} from '../../../src/constants/theme';
import { format, isToday, isYesterday } from 'date-fns';
import { BASE_URL } from '../../../src/services/api';
import api from '../../../src/services/api';

// ─── Message bubble ───────────────────────────────────────────────────────────
function Bubble({ msg, isMe }: { msg: ChatMessage; isMe: boolean }) {
  const time = format(new Date(msg.created_at), 'HH:mm');
  return (
    <View style={[s.bubbleRow, isMe && s.bubbleRowMe]}>
      {!isMe && <Avatar name={msg.sender_name} url={msg.sender_avatar} size={8} />}
      <View style={{ maxWidth: '75%', gap: 2 }}>
        {msg.image_url && (
          <Image
            source={{ uri: msg.image_url.startsWith('http') ? msg.image_url : BASE_URL.replace('/api/v1', '') + msg.image_url }}
            style={[s.msgImage, isMe && { alignSelf: 'flex-end' }]}
            resizeMode="cover"
          />
        )}
        {msg.message && (
          <View style={[s.bubble, isMe ? s.bubbleMe : s.bubbleThem]}>
            <Text style={[s.bubbleText, isMe && s.bubbleTextMe]}>{msg.message}</Text>
          </View>
        )}
        <Text style={[s.msgTime, isMe && { alignSelf: 'flex-end' }]}>
          {time}
          {isMe && (
            <Text style={{ color: msg.is_read ? Colors.teal : Colors.gray400 }}>
              {' '}
              {msg.is_read ? '✓✓' : '✓'}
            </Text>
          )}
        </Text>
      </View>
    </View>
  );
}

// ─── Date separator ───────────────────────────────────────────────────────────
function DateSep({ date }: { date: string }) {
  const d = new Date(date);
  const label = isToday(d) ? 'Today' : isYesterday(d) ? 'Yesterday' : format(d, 'EEE d MMM');
  return (
    <View style={s.dateSep}>
      <View style={s.dateSepLine} />
      <Text style={s.dateSepText}>{label}</Text>
      <View style={s.dateSepLine} />
    </View>
  );
}

export default function ChatScreen() {
  const { taskId } = useLocalSearchParams<{ taskId: string }>();
  const { user }   = useAuthStore();
  const listRef    = useRef<FlatList>(null);
  const qc         = useQueryClient();

  const [text, setText]           = useState('');
  const [sending, setSending]     = useState(false);
  const [typing, setTyping]       = useState<string | null>(null);
  const [messages, setMessages]   = useState<ChatMessage[]>([]);
  const typingTimer = useRef<ReturnType<typeof setTimeout>>();

  // Fetch task for header
  const { data: task } = useQuery({
    queryKey: ['task', taskId],
    queryFn:  () => tasksApi.get(taskId),
    select:   r => r.data.data,
  });

  // Fetch message history
  const { isLoading } = useQuery({
    queryKey: ['chat', taskId],
    queryFn:  () => api.get(`/tasks/${taskId}/messages`),
    select:   r => r.data.data as ChatMessage[],
    onSuccess: (data: ChatMessage[]) => setMessages(data ?? []),
    refetchInterval: false,
  });

  // Socket room for live messages
  const { sendMessage, sendTyping, markRead } = useTaskRoom(taskId, {
    onMessage: useCallback((msg: any) => {
      setMessages(prev => {
        if (prev.find(m => m.id === msg.id)) return prev;
        return [...prev, msg];
      });
      // Scroll to bottom
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 80);
    }, []),
    onTyping: useCallback((d: any) => {
      if (d.userId === user?.id) return;
      if (d.isTyping) {
        setTyping(d.userName);
        clearTimeout(typingTimer.current);
        typingTimer.current = setTimeout(() => setTyping(null), 3000);
      } else {
        setTyping(null);
      }
    }, [user?.id]),
    onReadAck: useCallback(() => {
      setMessages(prev => prev.map(m => m.sender_id === user?.id ? { ...m, is_read: true } : m));
    }, [user?.id]),
  });

  // Mark as read on open
  useEffect(() => {
    markRead();
    return () => clearTimeout(typingTimer.current);
  }, []);

  const handleSend = async () => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setText('');
    sendTyping(false);
    try {
      sendMessage(trimmed);
      // Optimistic message
      const optimistic: ChatMessage = {
        id:           `opt-${Date.now()}`,
        task_id:      taskId,
        sender_id:    user!.id,
        sender_name:  user!.name,
        message:      trimmed,
        is_read:      false,
        created_at:   new Date().toISOString(),
      };
      setMessages(prev => [...prev, optimistic]);
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 80);
    } finally {
      setSending(false);
    }
  };

  const handleTyping = (t: string) => {
    setText(t);
    sendTyping(t.length > 0);
    clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => sendTyping(false), 2000);
  };

  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
    });
    if (!result.canceled && result.assets[0]) {
      const asset = result.assets[0];
      const formData = new FormData();
      formData.append('image', { uri: asset.uri, type: 'image/jpeg', name: 'chat.jpg' } as any);
      try {
        const res = await api.post(`/tasks/${taskId}/images`, formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
        const url = res.data.data?.url;
        if (url) {
          sendMessage('', url);
          const optimistic: ChatMessage = {
            id: `opt-img-${Date.now()}`, task_id: taskId,
            sender_id: user!.id, sender_name: user!.name,
            image_url: url, is_read: false, created_at: new Date().toISOString(),
          };
          setMessages(prev => [...prev, optimistic]);
        }
      } catch {}
    }
  };

  // Group messages by date for separators
  const listData: Array<{ type: 'date'; date: string } | { type: 'msg'; msg: ChatMessage }> = [];
  let lastDate = '';
  for (const m of messages) {
    const d = m.created_at.slice(0, 10);
    if (d !== lastDate) { listData.push({ type: 'date', date: m.created_at }); lastDate = d; }
    listData.push({ type: 'msg', msg: m });
  }

  const otherName = task
    ? (user?.id === task.customer_id ? task.tasker_name : task.customer_name) ?? 'Tasker'
    : 'Chat';

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: Colors.surface }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      <Stack.Screen options={{
        headerShown: true,
        title: otherName,
        headerStyle: { backgroundColor: Colors.navy },
        headerTintColor: Colors.white,
        headerTitleStyle: { fontWeight: FontWeight.bold, color: Colors.white },
      }} />

      {isLoading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={Colors.teal} />
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={listData}
          keyExtractor={(item, i) => item.type === 'date' ? `date-${i}` : item.msg.id}
          renderItem={({ item }) =>
            item.type === 'date'
              ? <DateSep date={item.date} />
              : <Bubble msg={item.msg} isMe={item.msg.sender_id === user?.id} />
          }
          contentContainerStyle={{ padding: Spacing.md, paddingBottom: Spacing.xl }}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={s.empty}>
              <Ionicons name="chatbubbles-outline" size={48} color={Colors.gray300} />
              <Text style={s.emptyText}>No messages yet</Text>
              <Text style={s.emptySub}>Send a message to get started</Text>
            </View>
          }
        />
      )}

      {/* Typing indicator */}
      {typing && (
        <View style={s.typingBar}>
          <Text style={s.typingText}>{typing} is typing…</Text>
        </View>
      )}

      {/* Input bar */}
      <View style={s.inputBar}>
        <TouchableOpacity style={s.iconBtn} onPress={pickImage}>
          <Ionicons name="image-outline" size={22} color={Colors.gray400} />
        </TouchableOpacity>
        <TextInput
          style={s.input}
          value={text}
          onChangeText={handleTyping}
          placeholder="Message…"
          placeholderTextColor={Colors.gray400}
          multiline
          maxLength={2000}
          returnKeyType="default"
        />
        <TouchableOpacity
          style={[s.sendBtn, (!text.trim() || sending) && s.sendBtnDisabled]}
          onPress={handleSend}
          disabled={!text.trim() || sending}
        >
          {sending
            ? <ActivityIndicator size="small" color={Colors.white} />
            : <Ionicons name="send" size={17} color={Colors.white} />
          }
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  bubbleRow:       { flexDirection: 'row', gap: 8, marginBottom: 12, alignItems: 'flex-end' },
  bubbleRowMe:     { flexDirection: 'row-reverse' },
  bubble:          { borderRadius: Radius.xl, paddingHorizontal: 14, paddingVertical: 9, maxWidth: '100%' },
  bubbleMe:        { backgroundColor: Colors.teal },
  bubbleThem:      { backgroundColor: Colors.white, ...Shadow.xs },
  bubbleText:      { fontSize: FontSize.base, color: Colors.gray800, lineHeight: 21 },
  bubbleTextMe:    { color: Colors.white },
  msgImage:        { width: 200, height: 150, borderRadius: Radius.lg, marginBottom: 4 },
  msgTime:         { fontSize: 11, color: Colors.gray400, marginHorizontal: 4 },

  dateSep:         { flexDirection: 'row', alignItems: 'center', marginVertical: 16, gap: 8 },
  dateSepLine:     { flex: 1, height: 1, backgroundColor: Colors.border },
  dateSepText:     { fontSize: FontSize.xs, color: Colors.gray400, fontWeight: FontWeight.semibold },

  empty:           { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80, gap: 8 },
  emptyText:       { fontSize: FontSize.lg, fontWeight: FontWeight.semibold, color: Colors.gray500 },
  emptySub:        { fontSize: FontSize.sm, color: Colors.gray400 },

  typingBar:       { paddingHorizontal: Spacing.lg, paddingVertical: 6, backgroundColor: Colors.surface },
  typingText:      { fontSize: FontSize.sm, color: Colors.gray400, fontStyle: 'italic' },

  inputBar:        { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, paddingBottom: Platform.OS === 'ios' ? 28 : Spacing.sm, backgroundColor: Colors.white, borderTopWidth: 1, borderTopColor: Colors.border },
  iconBtn:         { padding: 8 },
  input:           { flex: 1, borderWidth: 1.5, borderColor: Colors.border, borderRadius: Radius.xl, paddingHorizontal: Spacing.md, paddingTop: 10, paddingBottom: 10, fontSize: FontSize.base, color: Colors.gray800, maxHeight: 120, backgroundColor: Colors.surface },
  sendBtn:         { width: 40, height: 40, borderRadius: 20, backgroundColor: Colors.teal, alignItems: 'center', justifyContent: 'center', ...Shadow.teal },
  sendBtnDisabled: { backgroundColor: Colors.gray300, shadowOpacity: 0 },
});
