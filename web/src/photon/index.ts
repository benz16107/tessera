// Photon pieces for the studio and the scout page. Mount PhotonPanel in a side panel ({ sessionId, code, myName }),
// ChannelBadges next to a participant ({ sessionId, participantId }), CheckinMarks inside the east-north-up group with
// rows from useCheckins(sessionId), and call useClaimInvite(me?.id) on the scout page.
export { PhotonPanel, ChannelBadges } from './PhotonPanel.tsx';
export { CheckinMarks } from './CheckinMarks.tsx';
export { useCheckins, useClaimInvite, usePeopleOnChannels, useVersions, usePhotonStatus, LABEL as CHANNEL_LABEL } from './hooks.ts';
