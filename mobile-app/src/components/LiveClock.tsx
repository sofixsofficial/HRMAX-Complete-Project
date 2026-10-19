import React, { useState, useEffect } from 'react';
import { View, Text } from 'react-native';

interface LiveClockProps {
  size?: 'sm' | 'md';
  showDate?: boolean;
}

export const LiveClock: React.FC<LiveClockProps> = ({ size = 'md', showDate = true }) => {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const time = now.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });
  const date = now.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });

  return (
    <View style={{ alignItems: 'flex-end' }}>
      <Text
        style={{
          fontSize: size === 'md' ? 20 : 13,
          fontWeight: '700',
          color: '#ffffff',
          fontVariant: ['tabular-nums'],
        }}
      >
        {time}
      </Text>
      {showDate && (
        <Text style={{ fontSize: 11, color: '#cbd5e1', marginTop: 2 }}>{date}</Text>
      )}
    </View>
  );
};
