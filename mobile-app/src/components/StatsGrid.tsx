import React from 'react';
import { View } from 'react-native';

export const StatsGrid: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', padding: 12, justifyContent: 'space-between', marginBottom: 16 }}>
      {React.Children.map(children, (child) => (
        <View style={{ width: '48%', marginBottom: 12 }}>
          {child}
        </View>
      ))}
    </View>
  );
};
