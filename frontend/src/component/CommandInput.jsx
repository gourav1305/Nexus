import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Send, Mic, MicOff, ImagePlus, X } from 'lucide-react';
import { playClickBlip, playHoverBlip, playActivationChime, playDeactivationChime } from '../utils/audioFeedback';

const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const MAX_IMAGE_SIZE = 4 * 1024 * 1024;

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result.split(',')[1];
      resolve({ base64, mimeType: file.type });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

const CommandInput = ({ onSend, onVisionSend, assistantEnabled, setAssistantEnabled, isThinking, audioFeedbackEnabled = true }) => {
  const [inputValue, setInputValue] = useState('');
  const [selectedImage, setSelectedImage] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef(null);

  const clearImage = () => {
    setSelectedImage(null);
    setImagePreview(null);
  };

  const [fileError, setFileError] = useState('');

  const processFile = useCallback(async (file) => {
    setFileError('');
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setFileError('Unsupported format. Use JPEG, PNG, GIF, or WebP.');
      return;
    }
    if (file.size > MAX_IMAGE_SIZE) {
      setFileError('Image too large. Max 4MB.');
      return;
    }
    const previewUrl = URL.createObjectURL(file);
    setImagePreview(previewUrl);
    const { base64, mimeType } = await readFileAsBase64(file);
    setSelectedImage({ base64, mimeType, name: file.name });
  }, []);

  useEffect(() => {
    return () => {
      if (imagePreview) URL.revokeObjectURL(imagePreview);
    };
  }, [imagePreview]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isThinking) return;

    if (selectedImage) {
      if (!inputValue.trim() && !selectedImage) return;
      if (audioFeedbackEnabled) playClickBlip();
      await onVisionSend({
        text: inputValue.trim(),
        imageBase64: selectedImage.base64,
        imageMimeType: selectedImage.mimeType,
      });
      setInputValue('');
      clearImage();
    } else {
      if (!inputValue.trim()) return;
      if (audioFeedbackEnabled) playClickBlip();
      onSend(inputValue);
      setInputValue('');
    }
  };

  const handleMicToggle = () => {
    if (audioFeedbackEnabled) {
      if (assistantEnabled) {
        playDeactivationChime();
      } else {
        playActivationChime();
      }
    }
    setAssistantEnabled(!assistantEnabled);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  };

  const handlePaste = (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type?.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) processFile(file);
        break;
      }
    }
  };

  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
    e.target.value = '';
  };

  const hasContent = inputValue.trim() || selectedImage;

  return (
    <div
      className={`command-input-container ${isDragOver ? 'drag-over' : ''} ${selectedImage ? 'has-image' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <form className="command-form" onSubmit={handleSubmit}>
        <div className="input-wrapper">
          {imagePreview && (
            <div className="image-preview-wrap">
              <img src={imagePreview} alt="Preview" className="image-preview" />
              <button type="button" className="image-preview-remove" onClick={clearImage}>
                <X size={14} />
              </button>
            </div>
          )}
          {fileError && <span className="file-error-msg">{fileError}</span>}
          <input
            type="text"
            className="nexus-input"
            placeholder={
              isThinking
                ? "Analyzing neural pathways..."
                : selectedImage
                  ? "Ask about this image..."
                  : "Ask NEXUS... (paste/drop images)"
            }
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onPaste={handlePaste}
            disabled={isThinking}
          />
          <div className="input-glow" />
        </div>

        <div className="input-actions">
          <button
            type="button"
            className={`action-btn image-btn ${selectedImage ? 'active' : ''}`}
            onClick={() => fileInputRef.current?.click()}
            title="Attach Image"
            onMouseEnter={() => { if (audioFeedbackEnabled) playHoverBlip(); }}
          >
            <ImagePlus size={20} />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp"
            style={{ display: 'none' }}
            onChange={handleFileSelect}
          />

          <button
            type="submit"
            className={`action-btn send-btn ${hasContent ? 'active' : ''}`}
            disabled={!hasContent || isThinking}
            title="Send Message"
            onMouseEnter={() => { if (audioFeedbackEnabled) playHoverBlip(); }}
          >
            <Send size={20} />
          </button>

          <button
            type="button"
            className={`action-btn mic-btn ${assistantEnabled ? 'active' : ''}`}
            onClick={handleMicToggle}
            title={assistantEnabled ? "Disable Voice Assistant" : "Enable Voice Assistant"}
            onMouseEnter={() => { if (audioFeedbackEnabled) playHoverBlip(); }}
          >
            {assistantEnabled ? <Mic size={20} /> : <MicOff size={20} opacity={0.6} />}
          </button>
        </div>
      </form>
    </div>
  );
};

export default CommandInput;
