import React from 'react';
import { Text, View, StyleSheet } from 'react-native';

interface MarkdownTextProps {
  children: string;
  style?: any;
}

export default function MarkdownText({ children, style }: MarkdownTextProps) {
  const renderMarkdown = (text: string) => {
    const lines = text.split('\n');
    const elements: React.ReactNode[] = [];

    lines.forEach((line, index) => {
      if (line.trim() === '') {
        elements.push(<View key={index} style={styles.lineBreak} />);
        return;
      }

      // Handle bold text **text**
      if (line.includes('**')) {
        const parts = line.split(/(\*\*[^*]+\*\*)/g);
        const lineElements = parts.map((part, partIndex) => {
          if (part.startsWith('**') && part.endsWith('**')) {
            const boldText = part.slice(2, -2);
            return (
              <Text key={partIndex} style={[style, styles.bold]}>
                {boldText}
              </Text>
            );
          }
          return (
            <Text key={partIndex} style={style}>
              {part}
            </Text>
          );
        });

        elements.push(
          <View key={index} style={styles.line}>
            {lineElements}
          </View>
        );
      } else {
        // Regular line
        elements.push(
          <Text key={index} style={[style, styles.line]}>
            {line}
          </Text>
        );
      }
    });

    return elements;
  };

  return <View>{renderMarkdown(children)}</View>;
}

const styles = StyleSheet.create({
  lineBreak: {
    height: 10,
  },
  line: {
    marginBottom: 2,
  },
  bold: {
    fontWeight: 'bold',
  },
});