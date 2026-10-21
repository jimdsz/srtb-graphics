/** Labels only: a new channel never inherits another channel's resources. */
export const channelPresets = ['Bénin TV Alafia','Bénin TV Kids'] as const;
export const channelNameKey = (name:string) => name.normalize('NFKD').replace(/\p{M}/gu,'').replace(/\s+/g,' ').trim().toLocaleLowerCase('fr');
