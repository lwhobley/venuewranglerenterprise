import React, { useState } from 'react';
import { StyleSheet, View, TouchableOpacity, Modal, ActivityIndicator } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useWorkspaceResolution, useSwitchWorkspace } from '../lib/workspace-routing';
import {
  chromeGold,
  deptTint,
  hairline,
  ink,
  radius,
  shadowSoft,
  spacing,
  stone,
  surfaceIvory,
} from '../lib/theme';

export function DepartmentSwitcher() {
  const [modalVisible, setModalVisible] = useState(false);
  const router = useRouter();

  const { data: workspace, isLoading } = useWorkspaceResolution();
  const switchMutation = useSwitchWorkspace();

  if (isLoading || !workspace || !workspace.assigned) {
    return null;
  }

  // If user only belongs to 1 department, show current department badge without switcher modal
  if (workspace.departments.length <= 1) {
    const currentDept = workspace.primaryDepartment ?? workspace.departments[0];
    const tint = deptTint(currentDept?.code);
    return (
      <View
        style={[
          styles.badgeContainer,
          {
            backgroundColor: '#FFFFFF',
            borderWidth: 1.5,
            borderColor: tint,
          },
        ]}
      >
        <MaterialCommunityIcons name="domain" size={14} color={tint} />
        <Text variant="labelMedium" style={{ color: ink, marginLeft: 6, fontWeight: '700' }}>
          {currentDept?.name ?? 'Assigned'}
        </Text>
      </View>
    );
  }

  const primaryDept = workspace.primaryDepartment;
  const activeTint = deptTint(primaryDept?.code);

  const handleSelectDepartment = async (deptId: string, defaultRoute: string) => {
    try {
      await switchMutation.mutateAsync(deptId);
      setModalVisible(false);
      router.replace(defaultRoute as any);
    } catch {
      // Keep state on failure
    }
  };

  return (
    <>
      <TouchableOpacity
        style={[
          styles.switcherButton,
          {
            backgroundColor: '#FFFFFF',
            borderColor: activeTint,
            borderWidth: 1.5,
          },
        ]}
        onPress={() => setModalVisible(true)}
        activeOpacity={0.8}
      >
        <MaterialCommunityIcons name="domain" size={16} color={activeTint} />
        <Text variant="labelMedium" style={{ color: ink, marginHorizontal: 6, fontWeight: '700' }}>
          {primaryDept?.name ?? 'Switch Workspace'}
        </Text>
        <MaterialCommunityIcons name="chevron-down" size={16} color={stone} />
      </TouchableOpacity>

      <Modal
        visible={modalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setModalVisible(false)}
      >
        <TouchableOpacity
          style={styles.modalBackdrop}
          activeOpacity={1}
          onPress={() => setModalVisible(false)}
        >
          <View style={[styles.modalContent, { backgroundColor: surfaceIvory, borderColor: '#D8CFC0' }]}>
            <View style={styles.modalHeader}>
              <Text variant="titleMedium" style={{ color: ink, fontWeight: '800' }}>
                Operational Workspaces
              </Text>
              <TouchableOpacity onPress={() => setModalVisible(false)}>
                <MaterialCommunityIcons name="close" size={20} color={stone} />
              </TouchableOpacity>
            </View>

            <Text variant="bodySmall" style={{ color: stone, marginBottom: 12 }}>
              Select an authorized department workspace to land in.
            </Text>

            {workspace.departments.map((deptItem) => {
              const isSelected = deptItem.id === primaryDept?.id;
              const itemTint = deptTint(deptItem.code);
              return (
                <TouchableOpacity
                  key={deptItem.id}
                  style={[
                    styles.deptItem,
                    {
                      backgroundColor: '#FFFFFF',
                      borderColor: isSelected ? itemTint : '#D8CFC0',
                      borderWidth: isSelected ? 1.5 : hairline,
                    },
                  ]}
                  onPress={() => handleSelectDepartment(deptItem.id, deptItem.defaultRoute)}
                  disabled={switchMutation.isPending}
                >
                  <View style={styles.deptItemLeft}>
                    {/* 4px department indicator rail */}
                    <View style={{ width: 4, height: 28, backgroundColor: itemTint, borderRadius: 2, marginRight: 10 }} />
                    <MaterialCommunityIcons
                      name={isSelected ? 'check-circle' : 'circle-outline'}
                      size={18}
                      color={isSelected ? itemTint : stone}
                    />
                    <View style={{ marginLeft: 8 }}>
                      <Text variant="bodyMedium" style={{ color: ink, fontWeight: isSelected ? '700' : '500' }}>
                        {deptItem.name}
                      </Text>
                      <Text variant="labelSmall" style={{ color: stone }}>
                        {deptItem.code.toUpperCase()}
                      </Text>
                    </View>
                  </View>

                  {switchMutation.isPending && isSelected && (
                    <ActivityIndicator size="small" color={itemTint} />
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  badgeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: radius.pill,
  },
  switcherButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: radius.pill,
    ...shadowSoft,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(18, 17, 14, 0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    width: '100%',
    maxWidth: 400,
    borderRadius: radius.control,
    padding: 20,
    borderWidth: hairline,
    ...shadowSoft,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  deptItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: radius.control,
    marginBottom: 8,
    overflow: 'hidden',
  },
  deptItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});
